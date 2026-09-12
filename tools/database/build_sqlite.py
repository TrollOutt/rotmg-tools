"""Build the Phase 1 SQLite migration database using only Python's stdlib."""
from __future__ import annotations
import argparse, hashlib, json, os, re, sqlite3, subprocess, sys, tempfile, uuid
from datetime import datetime, timezone
from pathlib import Path

from signature import stable_signature

ROOT = Path(__file__).resolve().parents[2]
NAMESPACE = uuid.UUID("2a20c00e-0d71-5eb3-85f9-5d66c9a52768")
SCHEMA = Path(__file__).with_name("schema.sql")

def canon(value): return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
def uid(*parts): return str(uuid.uuid5(NAMESPACE, "\x1f".join(map(str, parts))))
def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def rel(path): return path.relative_to(ROOT).as_posix()
def read_json(path): return json.loads(path.read_text(encoding="utf-8"))
def source_key(document, typ, client_id): return f"{document}|{dec_type(typ)}|{client_id or ''}"
def dec_type(value):
    try: return str(int(str(value), 0))
    except ValueError: return str(value)
def realmeye_slug(value):
    value=str(value or '').strip()
    value=re.sub(r'^https?://(?:www\.)?realmeye\.com/wiki/','',value,flags=re.I)
    value=re.sub(r'^/wiki/','',value,flags=re.I)
    return value.split('#',1)[0].split('?',1)[0].strip('/')

class Importer:
    # Index spaces are deliberately separate: wiki ids are not wiki pages.
    def __init__(self, con, report):
        self.con, self.report, self.snapshots, self.by_legacy = con, report, {}, {}
        self.entities_by_document_type, self.entities_by_document_type_client = {}, {}
        self.index_records, self.page_records, self.creature_records, self.biome_records = {}, {}, {}, {}
    def add_source(self, code, typ, category, description):
        self.con.execute("INSERT INTO sources VALUES(?,?,?,?)", (code, typ, category, description))
    def snapshot(self, code, path, metadata=None):
        if not path.exists(): self.report["sources"].append({"path": rel(path) if path.is_relative_to(ROOT) else str(path), "status": "missing"}); return None
        data = path.read_bytes(); sha = hashlib.sha256(data).hexdigest(); key = uid("snapshot", code, rel(path), sha)
        obj = None
        if path.suffix == ".json": obj = json.loads(data.decode("utf-8"))
        meta = dict(metadata or {}); meta["format"] = path.suffix.lstrip(".")
        if isinstance(obj, dict):
            # Keep rich provenance in metadata, but scalar snapshot columns
            # remain queryable values rather than a Python dict rendering.
            meta.update({k:obj[k] for k in ("from","built","generatedAt","source","schema","tool") if k in obj})
            source_from=obj.get("from") if isinstance(obj.get("from"),dict) else {}
            meta["source_version"]=source_from.get("build") or source_from.get("snapshot") or obj.get("version")
            meta["source_date"]=source_from.get("date") or obj.get("sourceDate") or obj.get("versionDate") or obj.get("built") or obj.get("generatedAt")
            meta["producer_tool"]=obj.get("tool")
        self.con.execute("INSERT INTO source_snapshots VALUES(?,?,?,?,?,?,?,?,?,?)", (key,code,rel(path),sha,len(data),str(meta.get("source_version") or "") or None,str(meta.get("source_date") or "") or None,str(meta.get("producer_tool") or "") or None,datetime.now(timezone.utc).isoformat(),canon(meta)))
        textual = path.suffix.lower() in {".json", ".txt", ".js", ".md"}
        self.con.execute("INSERT INTO raw_documents VALUES(?,?,?,?,?,?,?)", (uid("document",key),key,rel(path),path.suffix.lstrip("."),sha,data.decode("utf-8", errors="replace") if textual else None,canon({"stored_payload": textual})))
        self.snapshots[rel(path)] = key; self.report["sources"].append({"path":rel(path),"sha256":sha,"status":"imported","counts":{}})
        return key, obj
    def generated_index_snapshot(self, index):
        source = index.get("from")
        if not isinstance(source, dict) or not source.get("build") or not source.get("date"):
            raise ValueError("generated Index source lacks client provenance")
        payload = canon(index).encode("utf-8")
        sha = hashlib.sha256(payload).hexdigest()
        key = uid("snapshot", "client_data_index_source", source["build"], source["date"], sha)
        metadata = {
            "from": source,
            "source_model_sha256": sha,
            "source_producer": "tools/build-index.js",
            "generated_index_source": True,
            "production_index_input_dependency": False,
        }
        self.con.execute("INSERT INTO source_snapshots VALUES(?,?,?,?,?,?,?,?,?,?)", (key,"client_data_index_source","client-data/shared-index-source",sha,len(payload),str(source["build"]),str(source["date"]),"tools/build-index.js",datetime.now(timezone.utc).isoformat(),canon(metadata)))
        self.snapshots["client-data/shared-index-source"] = key
        self.report["sources"].append({"path":"client-data/shared-index-source","sha256":sha,"status":"generated","counts":{}})
        return key, index
    def entity(self, kind, basis, snapshot, legacy=None, status="normal"):
        key = uid("entity", basis)
        self.con.execute("INSERT OR IGNORE INTO entities VALUES(?,?,?,?,?,?)", (key,kind,status,basis,snapshot,legacy))
        if legacy: self.by_legacy[legacy] = key
        return key
    def record(self, snapshot, typ, key, entity, payload):
        # A client declaration key is deliberately human-inspectable.  A few
        # legacy declarations collide even on document/type/client-id, so keep
        # the complete legacy id as a deterministic discriminator rather than
        # silently merging source declarations.
        base = key
        while self.con.execute("SELECT 1 FROM source_records WHERE snapshot_uid=? AND record_type=? AND source_key=?", (snapshot,typ,key)).fetchone():
            discriminator = payload.get("id") if isinstance(payload,dict) else None
            key = base + "|legacy=" + str(discriminator or uid("duplicate", canon(payload)))
        rid = uid("record", snapshot, typ, key)
        self.con.execute("INSERT INTO source_records VALUES(?,?,?,?,?,?)", (rid,snapshot,typ,key,entity,canon(payload)))
        return rid
    def ref(self, entity, source, typ, value, metadata=None):
        if value is None: return
        self.con.execute("INSERT OR IGNORE INTO external_refs VALUES(?,?,?,?,?,?)", (uid("ref",entity,source,typ,value),entity,source,typ,str(value),canon(metadata or {})))
    def fact(self, entity, record, path, value, origin="migration"):
        self.con.execute("INSERT OR IGNORE INTO facts VALUES(?,?,?,?,?,?)", (uid("fact",entity,record,path),entity,record,path,canon(value),origin))
    def relation(self, source, typ, target, record, origin, attrs=None):
        attrs = canon(attrs or {}); key=uid("relation",source,typ,target or "",record or "",attrs)
        self.con.execute("INSERT OR IGNORE INTO relations VALUES(?,?,?,?,?,?,?)",(key,source,typ,target,record,origin,attrs)); return key
    def unresolved(self, record, typ, hint, reason, candidates=None):
        n=self.con.execute("SELECT COUNT(*) FROM unresolved_links WHERE source_record_uid IS ? AND relation_type=? AND target_hint=?",(record,typ,hint)).fetchone()[0]
        self.con.execute("INSERT INTO unresolved_links VALUES(?,?,?,?,?,?)",(uid("unresolved",record or "",typ,hint,n),record,typ,hint,reason,canon(candidates or [])))
    def link_entity(self, record, entity, link_type, method, metadata):
        self.con.execute("INSERT OR IGNORE INTO source_record_entities VALUES(?,?,?,?,?)",(record,entity,link_type,method,canon(metadata)))
    def source_relation(self, snapshot, from_record, typ, to_record, field, position, attributes=None):
        key=uid("source-relation",snapshot,from_record,typ,to_record,field,position)
        self.con.execute("INSERT INTO source_record_relations VALUES(?,?,?,?,?,?,?,?)",(key,snapshot,from_record,typ,to_record,field,position,canon(attributes or {})))
        return key

def import_index(imp, snap, index):
    files=index.get("files",[])
    contract={key:value for key,value in index.items() if key not in {"files","records","catalogues","views"}}
    imp.con.execute("INSERT INTO index_contract VALUES(?,?)",(snap,canon(contract)))
    for position,document in enumerate(files): imp.con.execute("INSERT INTO index_files VALUES(?,?,?)",(snap,position,document))
    for record_position,record in enumerate(index.get("records",[])):
        legacy=record["id"]; frm=record.get("from",[]); document=files[frm[0]] if len(frm)>1 and isinstance(frm[0],int) and frm[0] < len(files) else None; typ=frm[1] if len(frm)>1 else None; identity_client=record.get("alias") or record.get("clientId"); client=identity_client or record.get("name")
        if not isinstance(frm,list) or len(frm)!=2 or not isinstance(frm[0],int) or not 0<=frm[0]<len(files): raise ValueError(f"index.from invalid for {legacy}: {frm}")
        basis=("client|%s|%s|%s|%s"%(record["kind"],document,typ,identity_client)) if document and typ and identity_client else "legacy-index|%s|%s"%(record["kind"],legacy)
        ent=imp.entity(record["kind"],basis,snap,legacy); sk=source_key(document,typ,client) if document else legacy; rid=imp.record(snap,"index_record",sk,ent,record)
        imp.con.execute("INSERT INTO index_record_order VALUES(?,?,?)",(snap,record_position,ent))
        imp.con.execute("INSERT INTO index_primary_declarations VALUES(?,?,?,?,?)",(ent,rid,snap,frm[0],canon(frm[1])))
        for field_position,field_name in enumerate(record): imp.con.execute("INSERT INTO index_record_field_order VALUES(?,?,?)",(ent,field_position,field_name))
        imp.ref(ent,"client_data_index_source","legacy_index_id",legacy); imp.ref(ent,"client_data_index_source","display_name",record.get("name"));
        if document: imp.ref(ent,"client_data_index_source","client_document",document); imp.ref(ent,"client_data_index_source","client_type",dec_type(typ)); imp.ref(ent,"client_data_index_source","client_source_key",sk)
        imp.index_records[legacy]=rid
        if document and typ is not None:
            imp.entities_by_document_type.setdefault((document,dec_type(typ)),set()).add(ent)
        if client:
            imp.ref(ent,"client_data_index_source","client_id",client)
            imp.entities_by_document_type_client.setdefault((document,dec_type(typ),str(client)),set()).add(ent)
        for field, value in record.items():
            if field not in {"id","kind","from","also","folds","folded"}: imp.fact(ent,rid,field,value)
        for field in ("art","benchArt","benchPic","pic","icon"):
            if record.get(field) is not None:
                imp.con.execute("INSERT INTO asset_refs VALUES(?,?,?,?,?,?,?)",(uid("asset",snap,rid,field),snap,ent,str(record[field]),field,canon({"field":field}),rid))
        for pos, other in enumerate(record.get("also",[]) or []):
            if not isinstance(other,int) or not 0<=other<len(files): raise ValueError(f"index.also invalid for {legacy}: {other}")
            adoc,atyp,aid=files[other],typ,client; ask=source_key(adoc,atyp,aid); ar=imp.record(snap,"index_also",ask,ent,{"file_index":other,"from":[other,typ],"client_id":aid,"legacy_index_id":legacy}); imp.ref(ent,"client_data_index_source","client_document",adoc,{"also":True}); imp.ref(ent,"client_data_index_source","client_type",dec_type(atyp),{"also":True}); imp.ref(ent,"client_data_index_source","client_id",aid,{"also":True}); imp.ref(ent,"client_data_index_source","client_source_key",ask,{"also":True})
            imp.con.execute("INSERT INTO index_also_order VALUES(?,?,?,?,?)",(snap,ent,pos,ar,other))
            if atyp is not None: imp.entities_by_document_type.setdefault((adoc,dec_type(atyp)),set()).add(ent); imp.entities_by_document_type_client.setdefault((adoc,dec_type(atyp),str(aid)),set()).add(ent)
    # Folds are browse presentation; resolve only exact legacy declarations.
    for record in index.get("records",[]):
        if not record.get("folds"): continue
        rep=imp.by_legacy[record["id"]]; group=uid("browse",record["id"]); imp.con.execute("INSERT INTO browse_groups VALUES(?,?,?,?)",(group,rep,record.get("said") or record.get("name",record["id"]),canon({"legacy_id":record["id"],"folds":record["folds"]})))
        rep_seen=False
        for fold_position,fold in enumerate(record["folds"]):
            af=fold.get("from",[])
            if len(af)<2 or not isinstance(af[0],int) or not 0<=af[0]<len(files): raise ValueError(f"fold.from invalid for {record['id']}: {af}")
            doc,typ=files[af[0]],dec_type(af[1]); candidates=imp.entities_by_document_type.get((doc,typ),set()); method="document_type"
            if len(candidates)!=1 and fold.get("was") is not None:
                candidates=imp.entities_by_document_type_client.get((doc,typ,str(fold["was"])),set()); method="document_type_was"
            if len(candidates)==1:
                member=next(iter(candidates)); is_rep=1 if member==rep else 0; rep_seen=rep_seen or bool(is_rep)
                imp.con.execute("INSERT OR REPLACE INTO browse_group_members VALUES(?,?,?,?,?)",(group,member,is_rep,fold.get("why"),canon({**fold,"match_method":method})))
                imp.con.execute("INSERT INTO index_fold_order VALUES(?,?,?)",(group,fold_position,member))
                imp.report.setdefault("fold_methods",{}).setdefault(method,0); imp.report["fold_methods"][method]+=1
            else: imp.unresolved(None,"fold_member",canon(fold),"fold target is not an exact unique client declaration",sorted(candidates))
        if not rep_seen: imp.con.execute("INSERT OR IGNORE INTO browse_group_members VALUES(?,?,?,?,?)",(group,rep,1,"representative_without_fold",canon({"fallback":True})))
    for record in index.get("records",[]):
        target=record.get("folded")
        if target is None: continue
        entity=imp.by_legacy[record["id"]]; target_entity=imp.by_legacy.get(target)
        group=imp.con.execute("SELECT group_uid FROM browse_groups WHERE representative_entity_uid=?",(target_entity,)).fetchone() if target_entity else None
        if not group: raise ValueError(f"folded target is not a browse group: {record['id']} -> {target}")
        imp.con.execute("INSERT INTO index_folded_targets VALUES(?,?)",(entity,group[0]))
    for name, payload in sorted(index.get("catalogues",{}).items()):
        cid=uid("catalogue",name); imp.con.execute("INSERT INTO catalogues VALUES(?,?,?)",(cid,name,canon({"source":"index.catalogues"})))
        sections=[("root",payload)] if isinstance(payload,list) else sorted(payload.items()) if isinstance(payload,dict) else [("root",payload)]
        for section, values in sections:
            sid=uid("catalogue-section",cid,section); imp.con.execute("INSERT INTO catalogue_sections VALUES(?,?,?,?)",(sid,cid,section,canon({})))
            values=values if isinstance(values,list) else [{"key":k,"value":v} for k,v in sorted(values.items())] if isinstance(values,dict) else [values]
            for position,value in enumerate(values):
                key=(value.get("id") or value.get("key") or value.get("name") or str(position)) if isinstance(value,dict) else str(position); candidates=[]
                if isinstance(value,dict) and value.get("id"):
                    candidates=set().union(*[v for (d,t,c),v in imp.entities_by_document_type_client.items() if c==str(value["id"])]) if any(c==str(value["id"]) for d,t,c in imp.entities_by_document_type_client) else set()
                entity=next(iter(candidates)) if len(candidates)==1 else None
                imp.con.execute("INSERT INTO catalogue_members(catalogue_uid,entity_uid,legacy_key,position,payload_json,section) VALUES(?,?,?,?,?,?)",(cid,entity,str(key),position,canon(value),section))
    imp.con.execute("INSERT INTO stored_views VALUES(?,?,?,?)",(uid("view","theory",snap),"theory",snap,canon(index.get("views",{}).get("theory"))))

def import_wiki(imp,snap,wiki):
    pages=wiki.get("pages",[]); ids=wiki.get("ids",[])
    for i,page in enumerate(pages):
        if not isinstance(page,list) or len(page)<2: raise ValueError(f"wiki.pages[{i}] invalid")
        imp.page_records[i]=imp.record(snap,"realmeye_page",str(page[0]),None,{"slug":page[0],"title":page[1],"legacy_page_index":i})
    # wiki.page is [idIndex, pageIndex], and is intentionally many-to-many.
    page_entities={i:set() for i in range(len(pages))}
    for position,row in enumerate(wiki.get("page",[])):
        if len(row)!=2: raise ValueError(f"wiki.page[{position}] invalid")
        id_i,page_i=row
        if not 0<=id_i<len(ids) or not 0<=page_i<len(pages): raise ValueError(f"wiki.page[{position}] index out of range: {row}")
        legacy=ids[id_i]; entity=imp.by_legacy.get(legacy)
        if not entity: raise ValueError(f"wiki.page[{position}] unknown legacy id {legacy}")
        rid=imp.page_records[page_i]; meta={"id_index":id_i,"page_index":page_i,"legacy_index_id":legacy}
        imp.link_entity(rid,entity,"about","wiki.page",meta); imp.ref(entity,"realmeye","realmeye_slug",realmeye_slug(pages[page_i][0]),{"via":"wiki.page","page_index":page_i,"id_index":id_i})
        page_entities[page_i].add(entity)
    for page_i, entities in page_entities.items():
        if len(entities)==1: imp.con.execute("UPDATE source_records SET entity_uid=? WHERE record_uid=?",(next(iter(entities)),imp.page_records[page_i]))
    def page_pair(field, relation):
        for position,row in enumerate(wiki.get(field,[]) or []):
            if len(row)<2 or not 0<=row[0]<len(pages) or not 0<=row[1]<len(pages): raise ValueError(f"wiki.{field}[{position}] page index out of range: {row}")
            rid=imp.source_relation(snap,imp.page_records[row[0]],relation,imp.page_records[row[1]],field,position,{"payload":row})
            a,b=page_entities[row[0]],page_entities[row[1]]
            if len(a)==len(b)==1: imp.relation(next(iter(a)),relation,next(iter(b)),None,"observation",{"source_relation_uid":rid,"source_field":field,"source_position":position})
    # These are page->page, never ids->ids.
    page_pair("drop","drops"); page_pair("spawn","spawns"); page_pair("dungeon","dungeon_contains"); page_pair("tierDungeon","tier_dungeon")
    dungeon_by_pair={(row[0],row[1]): rid for rid,row in []}
    for position,row in enumerate(wiki.get("dungeonEvidence",[]) or []):
        if len(row)!=3 or not 0<=row[0]<len(pages) or not 0<=row[1]<len(pages) or not 0<=row[2]<len(wiki.get("dungeonSections",[])): raise ValueError(f"wiki.dungeonEvidence[{position}] index out of range: {row}")
        relation=imp.con.execute("SELECT relation_uid FROM source_record_relations WHERE snapshot_uid=? AND from_record_uid=? AND to_record_uid=? AND relation_type='dungeon_contains'",(snap,imp.page_records[row[0]],imp.page_records[row[1]])).fetchone()
        if not relation: raise ValueError(f"wiki.dungeonEvidence[{position}] has no dungeon relation")
        section=wiki["dungeonSections"][row[2]]; imp.con.execute("INSERT INTO source_relation_evidence VALUES(?,?,?,?,?)",(uid("source-evidence",relation[0],position),relation[0],"dungeon_section",section,canon({"section_index":row[2],"source_position":position,"payload":row,"dungeonFrom":wiki.get("dungeonFrom")})))
    # near alone is idIndex -> pageIndex.
    for position,row in enumerate(wiki.get("near",[]) or []):
        if len(row)!=2 or not 0<=row[0]<len(ids) or not 0<=row[1]<len(pages): raise ValueError(f"wiki.near[{position}] index out of range: {row}")
        imp.source_relation(snap,imp.index_records[ids[row[0]]],"near",imp.page_records[row[1]],"near",position,{"id_index":row[0],"page_index":row[1]})
    hands,lists=wiki.get("tierDropHands",[]),wiki.get("tierDropLists",[])
    for position,row in enumerate(wiki.get("tierDrop",[]) or []):
        if len(row)!=5 or not 0<=row[0]<len(pages) or not 0<=row[1]<len(hands) or not 0<=row[4]<len(lists): raise ValueError(f"wiki.tierDrop[{position}] index out of range: {row}")
        imp.con.execute("INSERT INTO wiki_tier_drops VALUES(?,?,?,?,?,?,?,?,?)",(uid("tier-drop",snap,position),snap,imp.page_records[row[0]],hands[row[1]],row[2],row[3],lists[row[4]],position,canon({"payload":row,"enemy_page_index":row[0],"hand_index":row[1],"list_index":row[4],"tierDropFrom":wiki.get("tierDropFrom")})))

def name_key(value): return re.sub(r"[^a-z0-9]+","",str(value).lower())
def import_realmeye(imp,snap,data):
    by_path={}
    creature_report={"total":0,"page_found":0,"page_not_found":0,"mapped_single":0,"mapped_multiple":0,"mapped_unique_name":0,"provisional":0,"unresolved":0}
    for path, creature in sorted(data.get("creatures",{}).items()):
        creature_report["total"]+=1; slug=realmeye_slug(path)
        page=imp.con.execute("SELECT record_uid FROM source_records WHERE record_type='realmeye_page' AND source_key=?",(slug,)).fetchone()
        mapped={x[0] for x in imp.con.execute("SELECT entity_uid FROM source_record_entities WHERE record_uid=? AND link_type='about'",(page[0],))} if page else set()
        if page: creature_report["page_found"]+=1
        else: creature_report["page_not_found"]+=1
        if len(mapped)==1: ent,status=next(iter(mapped)),"linked_explicit"
        elif len(mapped)>1: ent,status=None,"explicit_many_to_many"
        else:
            candidates=[e for legacy,e in imp.by_legacy.items() if name_key(legacy.split(":",1)[-1].split("#",1)[0])==name_key(creature.get("name"))]
            if len(set(candidates))==1: ent,status=list(set(candidates))[0],"linked_unique_name"; creature_report["mapped_unique_name"]+=1
            else: ent,status=imp.entity("realmeye_creature",f"realmeye|{slug}",snap,status="provisional"),"provisional"; creature_report["provisional"]+=1; creature_report["unresolved"]+=1
        rid=imp.record(snap,"realmeye_creature",path,ent if len(mapped)<=1 else None,creature)
        for linked in mapped: imp.link_entity(rid,linked,"about","realmeye_page_propagation",{"path":path,"slug":slug}); imp.ref(linked,"realmeye","realmeye_slug",slug,{"via":"realmeye_page_propagation"})
        if len(mapped)==1: creature_report["mapped_single"]+=1
        elif len(mapped)>1: creature_report["mapped_multiple"]+=1
        if ent: imp.ref(ent,"realmeye","realmeye_slug",slug); imp.ref(ent,"realmeye","display_name",creature.get("name")); imp.fact(ent,rid,"realmeye",creature,"observation")
        if status=="provisional": imp.unresolved(rid,"realmeye_creature",slug,"no explicit page mapping or unique exact name index match",candidates)
        imp.creature_records[path]=rid; by_path[path]=(ent,rid,status)
    for biome_id, biome in sorted(data.get("biomes",{}).items()):
        bent=imp.entity("biome",f"realmeye-biome|{biome_id}",snap,status="provisional"); brid=imp.record(snap,"realmeye_biome",biome_id,bent,biome); imp.biome_records[biome_id]=brid; imp.ref(bent,"realmeye","realmeye_slug",biome.get("slug")); imp.fact(bent,brid,"rank",biome.get("rank"),"observation")
        for role, members in sorted((biome.get("groups") or {}).items()):
            for member in members:
                ent,rid,_=by_path.get(member.get("path"),(None,None,None))
                if rid:
                    srid=imp.source_relation(snap,brid,"biome_member",rid,"groups",len(imp.con.execute("SELECT 1 FROM source_record_relations WHERE from_record_uid=?",(brid,)).fetchall()),{"role":role,"member":member})
                    resolved=ent if len({x[0] for x in imp.con.execute("SELECT entity_uid FROM source_record_entities WHERE record_uid=?",(rid,))})<=1 else None
                    imp.con.execute("INSERT INTO biome_memberships(membership_uid,biome_entity_uid,entity_uid,zone_uid,role,source_record_uid,payload_json,member_source_record_uid,source_relation_uid) VALUES(?,?,?,?,?,?,?,?,?)",(uid("biome",biome_id,rid,role),bent,resolved,None,role,brid,canon(member),rid,srid))
                    if ent: imp.relation(bent,"contains",ent,rid,"observation",{"role":role})
    imp.report["realmeye_creatures"]=creature_report

def import_atlas(imp,snap,atlas):
    map_uid=uid("map",snap,"legacy_atlas"); imp.con.execute("INSERT INTO realm_maps VALUES(?,?,?,?)",(map_uid,snap,"Legacy Atlas",canon({k:atlas.get(k) for k in ("px","chunk","bounds","mark")})))
    zones={}
    for zone in atlas.get("zones",[]):
        key=str(zone.get("id")); zid=uid("zone",map_uid,key); zones[key]=zid; biome=(atlas.get("biomes") or [])[zone.get("biome",-1)] if isinstance(zone.get("biome"),int) and zone.get("biome",-1)<len(atlas.get("biomes",[])) else {}
        rid=imp.record(snap,"atlas_zone",key,None,zone)
        imp.con.execute("INSERT INTO realm_zones VALUES(?,?,?,?,?,?,?,?,?,?,?)",(zid,map_uid,key,zone.get("name"),biome.get("ground") or zone.get("ground"),biome.get("name"),zone.get("tiles"),canon(zone.get("at")),biome.get("rank"),canon(zone),rid))
    for n,beacon in enumerate(atlas.get("beacons",[])):
        key=str(n); rid=imp.record(snap,"atlas_beacon",key,None,beacon); imp.con.execute("INSERT INTO realm_beacons VALUES(?,?,?,?,?,?,?,?,?)",(uid("beacon",map_uid,key),map_uid,key,zones.get(str(beacon.get("zone"))),beacon.get("name"),beacon.get("state"),canon([beacon.get("x"),beacon.get("y")]),canon(beacon),rid))
    for n,biome in enumerate(atlas.get("biomes",[])):
        imp.record(snap,"atlas_biome",str(n),None,biome); imp.con.execute("INSERT INTO realm_observations VALUES(?,?,?,?,?)",(uid("atlas-biome",snap,n),snap,"atlas_biome",str(n),canon(biome)))

def import_combat(imp,snap,combat):
    for kind, values in sorted(combat.items()):
        if not isinstance(values,dict): continue
        for key,payload in sorted(values.items(), key=lambda x:str(x[0])):
            candidate=set().union(*[v for (d,t,c),v in imp.entities_by_document_type_client.items() if t==str(key)]) if any(t==str(key) for d,t,c in imp.entities_by_document_type_client) else set()
            entity=next(iter(candidate)) if len(candidate)==1 else None; pid=uid("combat",snap,kind,key); rid=imp.record(snap,"combat_"+kind,str(key),entity,payload)
            imp.con.execute("INSERT INTO combat_profiles VALUES(?,?,?,?,?,?,?)",(pid,snap,entity,kind,str(key),canon(payload),rid))
            if kind=="observed": imp.con.execute("INSERT INTO observed_behaviors VALUES(?,?,?,?,?)",(uid("behavior",pid),pid,snap,str(key),canon(payload)))

def parse_zone_names(line):
    if line.startswith("#"): return None
    if line.startswith("join ") and " into " in line: return "zone_join",dict(zip(("from","to"),line[5:].split(" into ",1)))
    if line.startswith("@") and "|" in line: return "coordinate_name",dict(zip(("coordinate","name"),line.split("|",1)))
    if "|" in line: return "ground_place",dict(zip(("ground","place"),line.split("|",1)))
def parse_off_the_map(line):
    command,_,value=line.partition(" ")
    return ("off_map_"+command,{"value":value}) if command in {"class","id","keep","life","creatures","blank","elsewhere"} else None
def parse_realm_biomes(line):
    if re.match(r"^#[0-9a-fA-F]{6}\|",line) and line.count("|")==3: return "biome_colour",dict(zip(("colour","biome","when","who"),line.split("|")))
def parse_realm_beacons(line):
    if re.fullmatch(r"\d+\|\d+",line):
        x,y=line.split("|"); return "beacon_cell",{"column":int(x),"row":int(y)}
def parse_realm_terrain(line):
    if line.startswith("legend|"): return "terrain_legend",{"value":line}
def import_manual_rules(imp, snap, path):
    parsers={"zone-names.txt":parse_zone_names,"off-the-map.txt":parse_off_the_map,"realm-biomes.txt":parse_realm_biomes,"realm-beacons.txt":parse_realm_beacons,"realm-terrain.txt":parse_realm_terrain}
    parser=parsers.get(path.name)
    if not parser: return
    for position,raw in enumerate(path.read_text(encoding="utf-8").splitlines()):
        line=raw.strip()
        if not line: continue
        parsed=parser(line)
        if parsed:
            rule_type,payload=parsed; imp.con.execute("INSERT INTO manual_rules VALUES(?,?,?,?,?,?)",(uid("manual",snap,position,rule_type),snap,rule_type,position,raw,canon(payload)))


def build(output=None):
    output=Path(output) if output else ROOT/"data/Database/rotmg-tools.sqlite"; output.parent.mkdir(parents=True,exist_ok=True); tmp=output.with_suffix(output.suffix+".tmp")
    if tmp.exists(): tmp.unlink()
    report={"database":rel(output) if output.is_relative_to(ROOT) else str(output),"sources":[],"warnings":[],"entities":{},"relations":{},"realm":{},"unresolved":{},"provisional":{}}
    con=sqlite3.connect(tmp); con.execute("PRAGMA foreign_keys=ON")
    try:
        con.executescript(SCHEMA.read_text(encoding="utf-8")); imp=Importer(con,report)
        for row in [("client_data_index_source","index","derived","Deterministic Index source generated from client-data by tools/build-index.js."),("realmeye","realmeye","observation","RealmEye community observation snapshots."),("realm_capture","realm_capture","observation","Captured realm topology."),("manual","manual","manual","Editorial/manual realm files."),("generated_realm_snapshot","generated_realm","derived","Generated realm browser data."),("legacy_atlas_snapshot","atlas","migration","Legacy Atlas migration snapshot; never canonical."),("legacy_combat_snapshot","combat","migration","Legacy combat migration snapshot; never canonical.")]: imp.add_source(*row)
        with tempfile.TemporaryDirectory(prefix="rotmg-index-source-") as directory:
            source_path=Path(directory)/"index-source.json"
            subprocess.run(["node",str(ROOT/"tools/database/build_index_source.js"),"--output",str(source_path)],cwd=ROOT,check=True)
            idx=imp.generated_index_snapshot(read_json(source_path))

            # JSON artwork coordinates and sheet pixels are one runtime contract.
            # Persist the generated sheets beside the normalized semantic data so
            # publication cannot pair a new Index with stale PNGs.
            for public_path in (
                "web/assets/index/sheet.png",
                "web/assets/theory/sheet.png",
            ):
                generated=Path(directory)/"assets"/public_path
                if not generated.is_file():
                    raise RuntimeError(f"generated runtime asset missing: {public_path}")
                payload=generated.read_bytes()
                sha=hashlib.sha256(payload).hexdigest()
                con.execute(
                    "INSERT INTO runtime_assets(asset_path,snapshot_uid,media_type,sha256,size_bytes,payload) "
                    "VALUES(?,?,?,?,?,?)",
                    (
                        public_path,
                        idx[0],
                        "image/png",
                        sha,
                        len(payload),
                        sqlite3.Binary(payload),
                    ),
                )

        import_index(imp,*idx)
        wiki=imp.snapshot("realmeye",ROOT/"data/Index/wiki.json");
        if wiki: import_wiki(imp,*wiki)
        realmeye=imp.snapshot("realmeye",ROOT/"web/realmeye-data.json");
        if realmeye: import_realmeye(imp,*realmeye)
        for manual in sorted((ROOT/"data/Realm").glob("*.txt")):
            manual_snap=imp.snapshot("manual",manual)
            if manual_snap: import_manual_rules(imp,manual_snap[0],manual)
        generated=ROOT/"web/realm-data.js"; imp.snapshot("generated_realm_snapshot",generated)
        atlas=imp.snapshot("legacy_atlas_snapshot",ROOT/"web/assets/atlas/atlas.json");
        if atlas: import_atlas(imp,*atlas)
        combat=imp.snapshot("legacy_combat_snapshot",ROOT/"web/assets/atlas/combat.json");
        if combat: import_combat(imp,*combat)
        imp.snapshot("legacy_combat_snapshot",ROOT/"web/assets/atlas/combat-summary.json")
        con.commit(); bad=list(con.execute("PRAGMA foreign_key_check")); integrity=con.execute("PRAGMA integrity_check").fetchone()[0]
        if bad or integrity!="ok": raise RuntimeError(f"database validation failed: integrity={integrity}, fk={len(bad)}")
        for key,table in [("entities","entities"),("source_records","source_records"),("external_refs","external_refs"),("facts","facts"),("relations","relations"),("browse_groups","browse_groups"),("catalogues","catalogues"),("raw_documents","raw_documents"),("index_primary_declarations","index_primary_declarations"),("index_also_order","index_also_order"),("index_record_field_order","index_record_field_order"),("realm_zones","realm_zones"),("realm_beacons","realm_beacons"),("biome_memberships","biome_memberships"),("combat_profiles","combat_profiles"),("unresolved_links","unresolved_links")]: report[key]=con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        report["source_snapshots"]=con.execute("SELECT COUNT(*) FROM source_snapshots").fetchone()[0]; report["browse_group_members"]=con.execute("SELECT COUNT(*) FROM browse_group_members").fetchone()[0]; report["catalogue_sections"]=con.execute("SELECT COUNT(*) FROM catalogue_sections").fetchone()[0]; report["catalogue_members"]=con.execute("SELECT COUNT(*) FROM catalogue_members").fetchone()[0]; report["stored_views"]=con.execute("SELECT COUNT(*) FROM stored_views").fetchone()[0]; report["manual_rules"]=con.execute("SELECT COUNT(*) FROM manual_rules").fetchone()[0]; report["provisional_entities"]=con.execute("SELECT COUNT(*) FROM entities WHERE status='provisional'").fetchone()[0]; report["runtime_assets"]=con.execute("SELECT COUNT(*) FROM runtime_assets").fetchone()[0]; report["stable_signature"]=stable_signature(con); report["integrity_check"]=integrity; report["foreign_key_violations"]=0; report["index_build_source"]="client-data"; report["production_index_input_dependency"]=False; report["generated_index_source"]=True; report["raw_index_document_dependency"]=False; report["index_record_payload_dependency"]=False
        for item in report["sources"]:
            snapshot=imp.snapshots.get(item.get("path"))
            if snapshot: item["counts"]={"source_records":con.execute("SELECT COUNT(*) FROM source_records WHERE snapshot_uid=?",(snapshot,)).fetchone()[0],"raw_documents":con.execute("SELECT COUNT(*) FROM raw_documents WHERE snapshot_uid=?",(snapshot,)).fetchone()[0]}
        report["wiki"]={"pages":len(wiki[1].get("pages",[])) if wiki else 0,"ids":len(wiki[1].get("ids",[])) if wiki else 0,
          "page_links":con.execute("SELECT COUNT(*) FROM source_record_entities x JOIN source_records r ON r.record_uid=x.record_uid WHERE x.link_type='about' AND r.record_type='realmeye_page'").fetchone()[0],"multi_entity_pages":con.execute("SELECT COUNT(*) FROM (SELECT x.record_uid FROM source_record_entities x JOIN source_records r ON r.record_uid=x.record_uid WHERE x.link_type='about' AND r.record_type='realmeye_page' GROUP BY x.record_uid HAVING COUNT(*)>1)").fetchone()[0],
          "drop_relations":con.execute("SELECT COUNT(*) FROM source_record_relations WHERE source_field='drop'").fetchone()[0],"spawn_relations":con.execute("SELECT COUNT(*) FROM source_record_relations WHERE source_field='spawn'").fetchone()[0],"dungeon_relations":con.execute("SELECT COUNT(*) FROM source_record_relations WHERE source_field='dungeon'").fetchone()[0],"dungeon_evidence":con.execute("SELECT COUNT(*) FROM source_relation_evidence").fetchone()[0],"tier_drop_relations":con.execute("SELECT COUNT(*) FROM wiki_tier_drops").fetchone()[0],"tier_dungeon_relations":con.execute("SELECT COUNT(*) FROM source_record_relations WHERE source_field='tierDungeon'").fetchone()[0]}
        report["folding"]={"groups":report["browse_groups"],"source_fold_entries":sum(len(r.get("folds",[])) for r in idx[1].get("records",[])),"resolved_document_type":report.get("fold_methods",{}).get("document_type",0),"resolved_with_was":report.get("fold_methods",{}).get("document_type_was",0),"unresolved":con.execute("SELECT COUNT(*) FROM unresolved_links WHERE relation_type='fold_member'").fetchone()[0]}
        report["folding"]["using_said"]=con.execute("SELECT COUNT(*) FROM browse_groups bg JOIN v_index_record_labels label ON label.entity_uid=bg.representative_entity_uid WHERE label.said IS NOT NULL AND label.said!=label.name").fetchone()[0]
        report["folding"]["representative_fold_metadata_preserved"]=con.execute("SELECT COUNT(*) FROM browse_group_members WHERE is_representative=1 AND reason!='representative_without_fold'").fetchone()[0]
        report["unresolved"]={"total":report["unresolved_links"],"with_source_record":con.execute("SELECT COUNT(*) FROM unresolved_links WHERE source_record_uid IS NOT NULL").fetchone()[0],"without_source_record":con.execute("SELECT COUNT(*) FROM unresolved_links WHERE source_record_uid IS NULL").fetchone()[0],"by_type":dict(con.execute("SELECT relation_type,COUNT(*) FROM unresolved_links GROUP BY relation_type")),"by_reason":dict(con.execute("SELECT reason,COUNT(*) FROM unresolved_links GROUP BY reason"))}
        report["provisional"]={"total":report["provisional_entities"],"by_kind":dict(con.execute("SELECT kind,COUNT(*) FROM entities WHERE status='provisional' GROUP BY kind"))}
        report["realm"]={"zones":report["realm_zones"],"beacons":report["realm_beacons"],"biome_memberships":report["biome_memberships"],"manual_rules":con.execute("SELECT COUNT(*) FROM manual_rules").fetchone()[0]}
        report["index_declarations"]={"primary":con.execute("SELECT COUNT(*) FROM source_records WHERE record_type='index_record'").fetchone()[0],"also":con.execute("SELECT COUNT(*) FROM source_records WHERE record_type='index_also'").fetchone()[0],"client_source_refs":con.execute("SELECT COUNT(*) FROM external_refs WHERE ref_type='client_source_key'").fetchone()[0]}
        report["source_record_entity_links"]={k:con.execute("SELECT COUNT(*) FROM source_record_entities x JOIN source_records r ON r.record_uid=x.record_uid WHERE r.record_type=?",(k,)).fetchone()[0] for k in ("realmeye_page","realmeye_creature")}
        report["source_record_entity_links"]["other"]=con.execute("SELECT COUNT(*) FROM source_record_entities x JOIN source_records r ON r.record_uid=x.record_uid WHERE r.record_type NOT IN ('realmeye_page','realmeye_creature')").fetchone()[0]
        report["manual_rules_by_type"]=dict(con.execute("SELECT rule_type,COUNT(*) FROM manual_rules GROUP BY rule_type")); report["asset_refs"]=con.execute("SELECT COUNT(*) FROM asset_refs").fetchone()[0]; report["v_biome_members_rows"]=con.execute("SELECT COUNT(*) FROM v_biome_members").fetchone()[0]
        if any(x.get("status")=="missing" for x in report["sources"]): report["warnings"].append("Optional source files missing; see sources entries.")
        if report["unresolved_links"]: report["warnings"].append(f"{report['unresolved_links']} unresolved links are retained explicitly.")
        if report["provisional_entities"]: report["warnings"].append(f"{report['provisional_entities']} provisional entities remain.")
        report_path=output.with_name("import-report.json") if output.name=="rotmg-tools.sqlite" else None
        con.close(); os.replace(tmp,output)
        if report_path: report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
        print(json.dumps({k:report[k] for k in ("entities","source_records","relations","unresolved_links","stable_signature")},ensure_ascii=False)); return report
    except Exception:
        con.rollback(); con.close(); tmp.unlink(missing_ok=True); raise

if __name__=="__main__":
    parser=argparse.ArgumentParser(); parser.add_argument("--output"); args=parser.parse_args()
    try: build(args.output)
    except Exception as error: print(f"SQLite build failed: {error}",file=sys.stderr); raise
