#!/usr/bin/env python3
"""Query the SQLite index produced by index-realmeye-archive.py."""
from __future__ import annotations
import argparse, json, sqlite3, sys


def connect(path):
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    return con


def dump(rows, as_json=False):
    values = [dict(r) for r in rows]
    if as_json:
        print(json.dumps(values, ensure_ascii=False, indent=2))
        return
    if not values:
        print("No results.")
        return
    for row in values:
        print(" | ".join(f"{k}={v}" for k, v in row.items()))


def main():
    ap = argparse.ArgumentParser(description="Search the local RealmEye archive index.")
    ap.add_argument("--db", default="local/realmeye-monitor/processed/realmeye.sqlite")
    ap.add_argument("--json", action="store_true")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("search", help="Full-text search across complete page text")
    p.add_argument("query")
    p.add_argument("--type")
    p.add_argument("--limit", type=int, default=30)

    p = sub.add_parser("section", help="Full-text search inside sections")
    p.add_argument("query")
    p.add_argument("--heading")
    p.add_argument("--limit", type=int, default=30)

    p = sub.add_parser("fact", help="Find structured key/value facts")
    p.add_argument("key")
    p.add_argument("--contains")
    p.add_argument("--type")
    p.add_argument("--limit", type=int, default=100)

    p = sub.add_parser("page", help="Show one normalized page by slug or URL substring")
    p.add_argument("slug")

    p = sub.add_parser("keywords", help="List discovered structural/corpus keywords")
    p.add_argument("--source", choices=["heading","fact-key","table-header","label","corpus-term"])
    p.add_argument("--limit", type=int, default=100)

    p = sub.add_parser("types", help="Page type distribution")

    args = ap.parse_args()
    con = connect(args.db)

    if args.cmd == "search":
        sql = """SELECT p.url,p.title,p.type_guess,round(bm25(pages_fts),3) AS rank
                 FROM pages_fts JOIN pages p ON p.url=pages_fts.url
                 WHERE pages_fts MATCH ?"""
        vals = [args.query]
        if args.type:
            sql += " AND p.type_guess=?"; vals.append(args.type)
        sql += " ORDER BY bm25(pages_fts) LIMIT ?"; vals.append(args.limit)
        dump(con.execute(sql, vals), args.json)
    elif args.cmd == "section":
        sql = """SELECT s.page_url,p.title,s.heading,s.path,substr(s.text,1,500) AS text
                 FROM sections_fts f JOIN sections s ON s.page_url=f.page_url AND s.heading=f.heading AND s.path=f.path AND s.text=f.text
                 JOIN pages p ON p.url=s.page_url WHERE sections_fts MATCH ?"""
        vals = [args.query]
        if args.heading:
            sql += " AND lower(s.heading)=lower(?)"; vals.append(args.heading)
        sql += " LIMIT ?"; vals.append(args.limit)
        dump(con.execute(sql, vals), args.json)
    elif args.cmd == "fact":
        sql = """SELECT f.page_url,p.title,p.type_guess,f.key,f.value
                 FROM facts f JOIN pages p ON p.url=f.page_url
                 WHERE lower(f.key)=lower(?)"""
        vals = [args.key]
        if args.contains:
            sql += " AND lower(f.value) LIKE lower(?)"; vals.append("%" + args.contains + "%")
        if args.type:
            sql += " AND p.type_guess=?"; vals.append(args.type)
        sql += " ORDER BY p.title LIMIT ?"; vals.append(args.limit)
        dump(con.execute(sql, vals), args.json)
    elif args.cmd == "page":
        like = "%" + args.slug + "%"
        page = con.execute("SELECT * FROM pages WHERE url LIKE ? OR slug LIKE ? ORDER BY length(url) LIMIT 1", (like, like)).fetchone()
        if not page:
            print("No page found."); return 1
        payload = dict(page)
        payload["sections"] = [dict(r) for r in con.execute("SELECT ord,level,heading,path,text FROM sections WHERE page_url=? ORDER BY ord", (page["url"],))]
        payload["facts"] = [dict(r) for r in con.execute("SELECT key,value,source,section_ord FROM facts WHERE page_url=? ORDER BY id", (page["url"],))]
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    elif args.cmd == "keywords":
        if args.source:
            rows = con.execute("SELECT * FROM keywords WHERE source=? ORDER BY document_count DESC,occurrence_count DESC LIMIT ?", (args.source,args.limit))
        else:
            rows = con.execute("SELECT * FROM keywords ORDER BY document_count DESC,occurrence_count DESC LIMIT ?", (args.limit,))
        dump(rows, args.json)
    elif args.cmd == "types":
        dump(con.execute("SELECT type_guess,count(*) pages,round(avg(type_confidence),2) avg_confidence FROM pages GROUP BY type_guess ORDER BY pages DESC"), args.json)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
