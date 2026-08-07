#ifndef CLASSES_FUNCTIONS_H
#define CLASSES_FUNCTIONS_H

#include <QApplication>
#include <QObject>
#include <QLocale>
#include <QTranslator>
#include <QFontDatabase>

#include <iostream>
#include <string>
#include <string_view>
#include <vector>
#include <fstream>
#include <filesystem>
#include <set>
#include <map>
#include <unordered_set>
#include <unordered_map>
#include <chrono>
#include <thread>
#include <future>
#include <cmath>
#include <numeric>
#include <QDebug>
#include <QtDebug>

using namespace std::literals;

class Parameters : public QObject {
    Q_OBJECT

public:
    std::string itemType{};
    std::unordered_set<std::string> lockedMods{};
    std::string desiredMod{};
    std::string artifactSelection{};
    int slotAmount{};
    int lockedModAmount{};
    std::string dustType{};
    std::string itemName{};
    int threadAmount{};
    std::set<int> tiers{1,2,3,4};
    std::unordered_set<std::string> specialBaseTypes{};

public slots:
    void setType(QString newType)
    {
        itemType = newType.toStdString();
        //qDebug() << "Item type changed to: " << itemType << '\n';
        emit baseChanged();
    }
    void setLockedMods(std::unordered_set<std::string> newLockedMods)
    {
        lockedMods = newLockedMods;
        emit modsChanged();
        //qDebug() << "locked mods changed. new mods: ";
        //for (const auto& mod : lockedMods)
        //    qDebug() << mod << ", ";
        //qDebug() <<'\n';
    }
    void setSlots(int newSlotAmount)
    {
        slotAmount = newSlotAmount + 1;
        //qDebug() << "slot amount changed to: " << slotAmount <<'\n';
        emit slotsChanged();
    }
    void setDesired(QString newDesired)
    {
        desiredMod = newDesired.toStdString();
        emit desiredChanged();
        //qDebug() << "Desired mod changed to: " << desiredMod << '\n';
    }
    void setLockedAmount(int newLockedAmount)
    {
        lockedModAmount = newLockedAmount;
        //qDebug() << "locked mod amount changed to: " << lockedModAmount << '\n';
        emit lockedAmountChanged();
    }
    void setName(QString newName)
    {
        itemName = newName.toStdString();
        //qDebug() << "name changed to: " << QString::fromStdString(itemName) << '\n';
        emit nameChanged();
    }
    void setDustType(QString newDust)
    {
        dustType = newDust.toStdString();
        //qDebug()  << "dust changed to: " << QString::fromStdString(dustType) <<'\n';
        emit dustChanged();
    }
    void setTiers(QString numeral, Qt::CheckState state)
    {
        int tier;
        if (numeral == "I")
            tier = 1;
        else if (numeral == "II")
            tier = 2;
        else if (numeral == "III")
            tier = 3;
        else if (numeral == "IV")
            tier = 4;

        if (state == Qt::Checked)
            tiers.emplace(tier);
        else
            tiers.erase(tier);
        emit tiersChanged();
        //qDebug() << "permissible tiers changed to: ";
        //for (const auto& tier : tiers)
        //    qDebug() << tier << ", ";
        //qDebug() << '\n';
    }
    void setSpecialBaseTypes(QString baseType, Qt::CheckState state)
    {
        if (state == Qt::Checked)
            specialBaseTypes.emplace(baseType.toStdString());
        else
            specialBaseTypes.erase(baseType.toStdString());
        emit specialBaseTypesChanged();
    }
signals:
    void baseChanged();
    void modsChanged();
    void slotsChanged();
    void desiredChanged();
    void lockedAmountChanged();
    void nameChanged();
    void dustChanged();
    void tiersChanged();
    void specialBaseTypesChanged();
};

class Results {
public:
    std::string artifact{};
    double odds{};
    std::map<std::string,int> dustCost{ {"Green",0},{"Red",0},{"Purple",0} };
    int avgRollAmount{};
};

class Enchant {
public:
    std::string name{};
    std::string description{};
    int weight{};
    std::unordered_set<std::string> tags{};
    std::unordered_set<std::string> excludes{};
    std::unordered_set<std::string> item_tags{};
    std::string required_item{};
    int enchantID{};
    std::unordered_map<int,double> weightDistribution{};
    std::unordered_set<std::string> specialBaseRequirement{};
};

class EnchantView {
public:
    std::string_view name{};
    std::string_view description{};
    int weight{};
    std::unordered_set<std::string_view> tags{};
    std::unordered_set<std::string_view> excludes{};
    std::unordered_set<std::string_view> item_tags{};
    std::string_view required_item{};
    int enchantID{};

    EnchantView(const Enchant& enchant)
    {
        name = enchant.name;
        description = enchant.description;
        weight = enchant.weight;
        required_item = enchant.required_item;
        enchantID = enchant.enchantID;
        for (const auto& tag : enchant.tags)
        {
            tags.emplace(tag);
        }
        for (const auto& tag : enchant.excludes)
        {
            excludes.emplace(tag);
        }
        for (const auto& tag : enchant.item_tags)
        {
            item_tags.emplace(tag);
        }
    }
};

class EnchantLite {
public:
    int enchantID{};
    int weight{};
    std::unordered_set<int> tagIDs{};
    std::unordered_set<int> excludeIDs{};

    EnchantLite(const Enchant& enchant, const std::map<std::string_view, int>& tagToIntMap)
    {
        enchantID = enchant.enchantID;
        weight = enchant.weight;
        for (const auto& tag : enchant.tags)
        {
            tagIDs.emplace(tagToIntMap.at(tag));
        }
        for (const auto& tag : enchant.excludes)
        {
            excludeIDs.emplace(tagToIntMap.at(tag));
        }
    }
};


struct string_hash {
    using is_transparent = void;
    [[nodiscard]] size_t operator()(const char* txt) const {
        return std::hash<std::string_view>{}(txt);
    }
    [[nodiscard]] size_t operator()(std::string_view txt) const {
        return std::hash<std::string_view>{}(txt);
    }
    [[nodiscard]] size_t operator()(const std::string& txt) const {
        return std::hash<std::string>{}(txt);
    }
};

struct ArtifactData
{
    double multiplier{};
    std::unordered_set<std::string> tags{};
    std::unordered_set<std::string> excludes{};
};

struct ArtifactDataLite
{
    double multiplier{};
    std::unordered_set<int> tagIDs{};
    std::unordered_set<int> excludeIDs{};
};

class Artifacts {
public:
    std::string name{};
    std::string description{};
    std::pair<std::string, double> dustCost{};
    std::unordered_set<std::string> pools{};
    std::unordered_map<std::string, std::shared_ptr<ArtifactData>> multiplierData{};
};

/*
class ArtifactLite {
public:
    int nameID{};
    std::unordered_map<int, float> tagMultipliers{};
    std::pair<int, float> dustCost{};
    std::unordered_map<int, float> uniqueMultipliers{};

    ArtifactLite(const Artifacts& artifact, const std::map<std::string_view, int>& tagToIntMap, const std::map<std::string_view, int>& artifactToIntMap, const std::map<std::string_view, int>& awakenToIntMap, const std::map<std::string_view, int>& uniqueToIntMap)
    {
        nameID = artifactToIntMap.at(static_cast<std::string_view>(artifact.name));
        for (const auto& pair : artifact.tagMultipliers)
        {
            tagMultipliers.emplace(tagToIntMap.at(static_cast<std::string_view>(pair.first)), pair.second);
        }
        if (artifact.dustCost.first == "greenDust")
            dustCost = { 0, artifact.dustCost.second };
        else if (artifact.dustCost.first == "redDust")
            dustCost = { 1, artifact.dustCost.second };
        else if (artifact.dustCost.first == "purpleDust")
            dustCost = { 2, artifact.dustCost.second };
        else
            dustCost = { 3, artifact.dustCost.second };

        for (const auto& pair : artifact.uniqueMultipliers)
        {
            try
            {
                uniqueMultipliers.emplace(awakenToIntMap.at(static_cast<std::string_view>(pair.first)), pair.second);
            }
            catch (const std::exception&)
            {
                uniqueMultipliers.emplace(uniqueToIntMap.at(static_cast<std::string_view>(pair.first)), pair.second);
            }
        }
    }
};
*/

inline std::string concatenateParams(const std::unordered_map<std::string,Enchant>& enchant_list, const Parameters& parameters, const std::map<std::string_view, int>& tagToIntMap, const std::map<std::string_view, int>& artifactToIntMap, const std::map<std::string_view, int>& awakenToIntMap, const std::multimap<std::string,std::string>& awakenedItemMap)
{
    std::string itemTypeID = std::to_string(tagToIntMap.at(static_cast<std::string_view>(parameters.itemType)));
    std::string artifactID = std::to_string(artifactToIntMap.at(static_cast<std::string_view>(parameters.artifactSelection)));
    std::string itemNameID{};
    if (awakenedItemMap.contains(parameters.itemName))
        itemNameID = std::to_string(awakenToIntMap.at(static_cast<std::string_view>(awakenedItemMap.find(parameters.itemName)->second)));
    std::string desiredModID = std::to_string(enchant_list.at(parameters.desiredMod).enchantID);
    std::string slotAmount = std::to_string(parameters.slotAmount);
    std::set<std::string> lockedModIDs{};
    for (const auto& lockedMod : parameters.lockedMods)
        lockedModIDs.emplace(std::to_string(enchant_list.at(lockedMod).enchantID));
    std::set<std::string> specialBaseTagIDs{};
    for (const auto& tag : parameters.specialBaseTypes)
    {
        if (tag == "SUMMONPOWERED")
            specialBaseTagIDs.emplace(std::to_string(tagToIntMap.at(static_cast<std::string_view>("SUMMONPOWER"))));
        else
            specialBaseTagIDs.emplace(std::to_string(tagToIntMap.at(static_cast<std::string_view>(tag))));
    }
    return (slotAmount + "-" + itemTypeID + "-" + desiredModID + "-" + artifactID + "-" + itemNameID + "-" + std::accumulate(lockedModIDs.begin(), lockedModIDs.end(), std::string{}) + "-" + std::accumulate(specialBaseTagIDs.begin(),specialBaseTagIDs.end(), std::string{}));
}


inline std::unordered_map<std::string, Enchant> cullEnchantList(std::unordered_map<std::string, Enchant> enchant_list, const std::unordered_set<std::string>& excludeTags, const std::string& itemType)
{

    //std::cout << "Number of mods prior to culling for item type: " << enchant_list.size() << "\n\n";

    if (!itemType.contains("na"sv))
    {
        //std::cout << "Beginning cull for item type. \n";

        for (auto i = enchant_list.begin(), last = enchant_list.end(); i != last;)
        {

            auto search = i->second.item_tags.find(static_cast<std::string>(itemType));
            if (search == i->second.item_tags.end())
            {
                //std::cout << "Erasing mod " << i->second.name << " due to item type; incompatible with item type " << itemType <<". \n";
                i = enchant_list.erase(i);
            }
            else if (i->second.excludes.find("AWAKENED") != i->second.excludes.end())
            {
                //std::cout << "Erasing mod " << i->second.name << ": it is an incompatible awakened mod. \n";
                i = enchant_list.erase(i);
            }
            else
            {
                //std::cout << "Mod " << i->second.name << " is valid for this item base. \n";
                ++i;
            }


        }
        // std::cout << "Number of mods after culling for item type: " << enchant_list.size() << "\n\n";
        //std::cout << "Number of mods evaluated for item type cull: " << evaluationCounter << "\n\n";
    }
    if (!excludeTags.empty())
    {

        //std::cout << "Beginning cull for incompatible tags. \n";
        //std::cout << "Number of mods prior to culling for incompatible tags: " << enchant_list.size() << "\n\n";


        for (auto i = enchant_list.begin(), last = enchant_list.end(); i != last;)
        {
            bool isExcluded{ false };
            for (const auto& tagBeingTested : excludeTags)
            {
                if (i->second.excludes.find(tagBeingTested) != i->second.excludes.end())
                {
                    //   std::cout << "Erasing mod " << i->second.name << " due to incompatible tag " << tagBeingTested << ". \n";
                    i = enchant_list.erase(i);
                    isExcluded = true;
                    break;
                }
            }
            if (!isExcluded)
            {
                //std::cout << "Mod " << i->second.name << " is not incompatible with the given exclusions. \n";
                ++i;
            }
        }
    }
    return enchant_list;
}

inline std::map<int, EnchantLite> initialLiteCull(const Parameters& paramObject, const std::unordered_map<std::string,Enchant>& enchant_list, const std::unordered_map<std::string,Artifacts>& artifact_list, std::map<int, EnchantLite> LiteList, const std::unordered_set<int>& excludeTagIDs, const int& itemType = 999, int awakenedTagID = 4, std::unordered_set<int> itemBaseID = {}, std::unordered_map<int, std::unordered_set<int>>enchantIDtoItemTagMap = {}, const std::unordered_map<int, std::string>& reverseEnchantIDMap = {})
{
    if (itemType != 999)
    {
        for (auto i = LiteList.begin(), last = LiteList.end(); i != last;)
        {
            auto search = enchantIDtoItemTagMap.at(i->second.enchantID).find(itemType);
            if (search == enchantIDtoItemTagMap.at(i->second.enchantID).end())
            {
                i = LiteList.erase(i);
            }
            else if (i->second.excludeIDs.contains(awakenedTagID) && !itemBaseID.contains(i->second.enchantID))   //4 is the tagID for "AWAKENED" in the current tagToIntMap
            {
                i = LiteList.erase(i);
            }
            else if (!enchant_list.at(reverseEnchantIDMap.at(i->second.enchantID)).specialBaseRequirement.empty())
            {
                bool erased{ false };
                auto tempID = i->second.enchantID;
                for (const auto& req : enchant_list.at(reverseEnchantIDMap.at(tempID)).specialBaseRequirement)
                {
                    if (!paramObject.specialBaseTypes.contains(req))
                    {
                        if (artifact_list.contains(paramObject.artifactSelection))
                        {

                            if (!artifact_list.at(paramObject.artifactSelection).pools.contains(req))
                            {
                                erased = true;
                                break;
                            }
                        }
                        else
                        {
                            erased = true;
                            break;
                        }
                    }
                }
                if (erased)
                {
                    i = LiteList.erase(i);
                }
                else
                {
                    ++i;
                }
            }
            else
            {
                ++i;
            }
        }
    }
    for (auto i = LiteList.begin(), last = LiteList.end(); i != last;)
    {
        bool isExcluded{ false };
        for (const auto& tagBeingTested : excludeTagIDs)
        {
            if (i->second.excludeIDs.find(tagBeingTested) != i->second.excludeIDs.end())
            {
                i = LiteList.erase(i);
                isExcluded = true;
                break;
            }
        }
        if (!isExcluded)
        {
            ++i;
        }
    }
    return LiteList;
}

inline std::map<int, EnchantLite> cullLiteList(std::map<int, EnchantLite> LiteList, const std::unordered_set<int>& excludeTagIDs)
{
    if (!excludeTagIDs.empty())
    {
        for (auto i = LiteList.begin(), last = LiteList.end(); i != last;)
        {
            bool isExcluded{ false };
            for (const auto& tagBeingTested : excludeTagIDs)
            {
                if (i->second.excludeIDs.find(tagBeingTested) != i->second.excludeIDs.end())
                {
                    i = LiteList.erase(i);
                    isExcluded = true;
                    break;
                }
            }
            if (!isExcluded)
            {
                ++i;
            }
        }
    }
    return LiteList;
}

inline std::vector<bool> cullMask(const std::map<int, EnchantLite>& LiteList, const std::unordered_set<int>& excludeTagIDs, std::vector<bool> mask)
{
    for (const auto& enchant : LiteList)
    {
        for (const auto& tagBeingTested : excludeTagIDs)
        {
            if (enchant.second.excludeIDs.find(tagBeingTested) != enchant.second.excludeIDs.end())
            {
                mask[enchant.second.enchantID] = false;
                break;
            }
        }
    }
    return mask;
}

inline std::unordered_map<std::string_view, EnchantView, string_hash, std::equal_to<>> getMutuals(const std::unordered_map<std::string_view, EnchantView>& enchant_list, const std::string& desiredModID)
{
    std::unordered_map<std::string_view, EnchantView, string_hash, std::equal_to<>> mutualExclusionMap{};
    for (auto i = enchant_list.begin(); i != enchant_list.end(); ++i)
    {
        for (const auto& tagBeingTested : enchant_list.at(static_cast<std::string_view>(desiredModID)).excludes)
        {
            if (i->second.excludes.find(tagBeingTested) != i->second.excludes.end())
            {
                mutualExclusionMap.emplace(i->first, i->second);
                // std::cout << "Mod " << i->second.name << " shares an exclusion tag with the desired mod. Added to mutual exclusion map. \n";
                break;
            }
        }
    }

    return mutualExclusionMap;
}
inline std::set<int> getLiteMutuals(const std::map<int,EnchantLite>& LiteList, const EnchantLite& desiredModLite)
{
    std::set<int> mutualExclusionSet{};
    for (const auto& enchant : LiteList)
    {
        for (const auto& tagBeingTested : desiredModLite.excludeIDs)
        {
            if (enchant.second.excludeIDs.find(tagBeingTested) != enchant.second.excludeIDs.end())
            {
                mutualExclusionSet.emplace(enchant.second.enchantID);
                break;
            }
        }
    }
    return mutualExclusionSet;
}

inline std::pair<int, int> maskRollOdds(const std::vector<int>& modWeights, const std::vector<bool>& mask, const int& desiredModID)
{
    int weightPool{};

    for (int i{}; i < modWeights.size(); i++)
    {
        if (mask[i])
        {
            weightPool += modWeights[i];
        }
    }
    return std::pair<int, int>(modWeights[desiredModID], weightPool);
}

inline std::unordered_set <std::string_view> addExcludes(std::unordered_set<std::string_view> currentExcludes, const std::unordered_set<std::string_view>& newExcludes)
{
    for (const auto& tag : newExcludes)
    {
        currentExcludes.emplace(tag);
    }
    return currentExcludes;
}
inline std::unordered_set<int> addLiteExcludes(std::unordered_set<int> currentExcludes, const std::unordered_set<int>& newExcludes)
{
    for (const auto& tag : newExcludes)
    {
        currentExcludes.emplace(tag);
    }
    return currentExcludes;
}

inline void getParameters(Parameters& parameters)
{
    //Parameters parameters{};
    std::string itemTypeTemp{};

    std::cout << "Enter item type (WEAPON, ABILITY, ARMOR, RING, or NA for no preference): ";
    std::cin >> itemTypeTemp;
    parameters.itemType = itemTypeTemp;
    std::cout << "Enter desired mod name: ";
    std::getline(std::cin >> std::ws, parameters.desiredMod);
    std::cout << "Enter artifact used (or 'na' for no artifact): ";
    std::getline(std::cin >> std::ws, parameters.artifactSelection);
    std::cout << "Enter number of slots on item (1-4): ";
    std::cin >> parameters.slotAmount;
    std::cout << "Enter number of locked mods (0-3): ";
    std::cin >> parameters.lockedModAmount;
    std::cout << "Enter item name: ";
    std::getline(std::cin >> std::ws, parameters.itemName);
    for (int i{}; i < parameters.lockedModAmount; i++)
    {
        std::string lockedModID{};
        std::cout << "Enter locked mod name " << (i + 1) << ": ";
        std::getline(std::cin >> std::ws, lockedModID);
        parameters.lockedMods.emplace(lockedModID);
    }
    parameters.threadAmount = std::thread::hardware_concurrency();

    return;
}

inline double createTrees(const std::unordered_map<std::string, Enchant>& enchant_list, const std::unordered_map<std::string, Artifacts>& artifact_list, const Parameters& parameters, const std::map<std::string_view, int>& tagToIntMap, const std::map<std::string_view, int>& artifactToIntMap, const std::map<std::string_view, int>& awakenToIntMap, const std::map<std::string_view, int>& uniqueToIntMap, const std::multimap<std::string,std::string>& awakenedItemMap, const std::unordered_map<int, std::string>& reverseEnchantIDMap)
{
    int desiredID = enchant_list.at(parameters.desiredMod).enchantID;
    int artifactID{};
    if (parameters.artifactSelection == "na"sv)
        artifactID = 999;
    else
        artifactID = artifactToIntMap.at(static_cast<std::string_view>(parameters.artifactSelection));
    int itemTypeID = tagToIntMap.at(static_cast<std::string_view>(parameters.itemType));
    std::unordered_set<int> itemBaseID{999};
    if (awakenedItemMap.contains(parameters.itemName))
    {
        auto [first, last] = awakenedItemMap.equal_range(parameters.itemName);
        for (auto i = first; i != last; ++i)
            itemBaseID.emplace(awakenToIntMap.at(static_cast<std::string_view>(i->second)));
    }
    std::unordered_set<int> lockedMods{};
    for (const auto& lockedMod : parameters.lockedMods)
        lockedMods.emplace(enchant_list.at(lockedMod).enchantID);

    std::unordered_map<int, std::unordered_set<int>> enchantIDtoItemTagMap{};
    std::map<int, EnchantLite> enchant_lite_list{};

    for (const auto& enchantPair : enchant_list)
    {
        enchant_lite_list.emplace(enchantPair.second.enchantID, EnchantLite(enchantPair.second, tagToIntMap));
        enchantIDtoItemTagMap.emplace(enchantPair.second.enchantID, std::unordered_set<int>{});
        for (const auto& itemTag : enchantPair.second.item_tags)
        {
            enchantIDtoItemTagMap.at(enchantPair.second.enchantID).emplace(tagToIntMap.at(static_cast<std::string_view>(itemTag)));
        }
    }
    /*
    std::map<int, ArtifactLite> artifact_lite_list{};
    for (const auto& artifactPair : artifact_list)
    {
        artifact_lite_list.emplace(artifactToIntMap.at(static_cast<std::string_view>(artifactPair.first)), ArtifactLite(artifactPair.second, tagToIntMap, artifactToIntMap, awakenToIntMap, uniqueToIntMap));
    }
    */
    std::unordered_set<int> initialLiteExcludes{};
    for (const auto& lockedMod : lockedMods)
        initialLiteExcludes = addLiteExcludes(initialLiteExcludes, enchant_lite_list.at(lockedMod).excludeIDs);
    enchant_lite_list = initialLiteCull(parameters,enchant_list,artifact_list,enchant_lite_list, initialLiteExcludes, itemTypeID, tagToIntMap.at("AWAKENED"sv),itemBaseID,enchantIDtoItemTagMap, reverseEnchantIDMap);

    if (!enchant_lite_list.contains(desiredID))
    {
        std::cout << "Desired mod is not compatible with the given parameters. Exiting createTrees().\n";
        return 0.0;
    }
    std::set<int> mutuallyIncompatibleLiteMods{getLiteMutuals(enchant_lite_list, enchant_lite_list.at(desiredID)) };

    std::map<int, std::set<int>> threadEnchantLiteSubLists{};

    int iter{};
    for (const auto& enchantLite : enchant_lite_list)
    {
        threadEnchantLiteSubLists[iter].emplace(enchantLite.first);
        if (iter == parameters.threadAmount - 1)
            iter = 0;
        else
            iter++;
    }



    std::vector<std::future<double>> threads{};
    for (int i{}; i < parameters.threadAmount; i++)
    {
        threads.emplace_back(std::async(std::launch::async, [&, i/*, weights = modWeightsLite, mask = initialModMask */]()
                                        {
                                            double threadMaskOdds{};
                                            int highestID{ -1 };
                                            for (const auto& id : enchant_list)
                                                highestID = std::max(highestID, id.second.enchantID);

                                            std::vector<int> weights(highestID + 1, 0);
                                            if (parameters.artifactSelection == "na"sv)
                                            {
                                                for (const auto& enchant : enchant_lite_list)
                                                    weights[enchant.first] = enchant.second.weight;
                                            }
                                            else
                                            {
                                                const auto& multiplierData = artifact_list.at(parameters.artifactSelection).multiplierData;
                                                for (const auto& enchant : enchant_lite_list)
                                                {
                                                    float multiplier{ -1.0f };

                                                    for (const auto& tag : enchant.second.tagIDs)
                                                    {
                                                        for (const auto& artTag : multiplierData)
                                                        {
                                                            std::string_view artTagSV{ static_cast<std::string_view>(artTag.first) };
                                                            int artTagID{ -1 };
                                                            bool isTag{ false };
                                                            bool isAwaken{ false };
                                                            bool isUnique{ false };

                                                            if (tagToIntMap.contains(artTagSV))
                                                            {
                                                                artTagID = tagToIntMap.at(artTagSV);
                                                                isTag = true;
                                                            }
                                                            else if (awakenToIntMap.contains(artTagSV))
                                                            {
                                                                artTagID = awakenToIntMap.at(artTagSV);
                                                                isAwaken = true;
                                                            }
                                                            else if (uniqueToIntMap.contains(artTagSV))
                                                            {
                                                                artTagID = uniqueToIntMap.at(artTagSV);
                                                                isUnique = true;
                                                            }

                                                            if (artTagID == -1)
                                                                continue;

                                                            if (isTag && artTagID != tag)
                                                                continue;
                                                            if (isAwaken && artTagID != enchant.second.enchantID)
                                                                continue;
                                                            if (isUnique && artTagID != enchant.second.enchantID)
                                                                continue;

                                                            bool isExcluded(false);
                                                            for (const auto& artExcludes : artTag.second->excludes)
                                                            {
                                                                int artExcludesID{ -1 };
                                                                if (auto it = tagToIntMap.find(static_cast<std::string_view>(artExcludes)); it != tagToIntMap.end())
                                                                    artExcludesID = it->second;

                                                                if (artExcludesID != -1 && enchant.second.tagIDs.contains(artExcludesID))
                                                                {
                                                                    isExcluded = true;
                                                                    break;
                                                                }
                                                            }
                                                            if (!isExcluded)
                                                                multiplier = std::max(multiplier, static_cast<float>(artTag.second->multiplier));
                                                            /*
                                bool isExcluded(false);
                                for (const auto& artExcludes : artTag.second->excludes)
                                {
                                    std::string_view artExcludesSV{ static_cast<std::string_view>(artExcludes) };
                                    int artExcludesID{ -1 };
                                    if (tagToIntMap.find(artExcludesSV) != tagToIntMap.end())
                                        artExcludesID = tagToIntMap.at(artExcludesSV);
                                    else if (awakenToIntMap.find(artExcludesSV) != awakenToIntMap.end())
                                        artExcludesID = awakenToIntMap.at(artExcludesSV);
                                    else if (uniqueToIntMap.find(artExcludesSV) != uniqueToIntMap.end())
                                        artExcludesID = uniqueToIntMap.at(artExcludesSV);


                                    if (artExcludesID != -1 && enchant.second.tagIDs.contains(artExcludesID))
                                    {
                                        isExcluded = true;
                                        break;
                                    }

                                }
                                if (!isExcluded)
                                    multiplier = std::max(multiplier, static_cast<float>(artTag.second->multiplier));
                                */


                                                            /*
                                if (tagToIntMap.contains(static_cast<std::string_view>(artTag.first)))
                                {
                                    if (tagToIntMap.at(static_cast<std::string_view>(artTag.first)) == tag)
                                    {
                                        bool isExcluded(false);
                                        for (const auto& artExcludes : artTag.second->excludes)
                                        {
                                            if (enchant.second.excludeIDs.contains(tagToIntMap.at(static_cast<std::string_view>(artExcludes))))
                                            {
                                                isExcluded = true;
                                                break;
                                            }
                                        }
                                        if (!isExcluded)
                                            multiplier = std::max(multiplier, static_cast<float>(artTag.second->multiplier));
                                    }
                                }
                                else if (awakenToIntMap.contains(static_cast<std::string_view>(artTag.first)))
                                {
                                    if (awakenToIntMap.at(static_cast<std::string_view>(artTag.first)) == tag)
                                    {
                                        bool isExcluded(false);
                                        for (const auto& artExcludes : artTag.second->excludes)
                                        {
                                            if (enchant.second.excludeIDs.contains(tagToIntMap.at(static_cast<std::string_view>(artExcludes))))
                                            {
                                                isExcluded = true;
                                                break;
                                            }
                                        }
                                        if (!isExcluded)
                                            multiplier = std::max(multiplier, static_cast<float>(artTag.second->multiplier));
                                    }
                                }
                                else if (uniqueToIntMap.contains(static_cast<std::string_view>(artTag.first)))
                                {
                                    if (uniqueToIntMap.at(static_cast<std::string_view>(artTag.first)) == tag)
                                    {
                                        bool isExcluded(false);
                                        for (const auto& artExcludes : artTag.second->excludes)
                                        {
                                            if (enchant.second.excludeIDs.contains(tagToIntMap.at(static_cast<std::string_view>(artExcludes))))
                                            {
                                                isExcluded = true;
                                                break;
                                            }
                                        }
                                        if (!isExcluded)
                                            multiplier = std::max(multiplier, static_cast<float>(artTag.second->multiplier));
                                    }
                                }
                                */
                                                        }
                                                    }
                                                    if (multiplier == -1.0f)
                                                        weights[enchant.first] = enchant.second.weight;
                                                    else
                                                        weights[enchant.first] = static_cast<int>(enchant.second.weight * multiplier);

                                                    //auto current_numeric_id = std::hash<std::thread::id>{}(std::this_thread::get_id());
                                                    //size_t threadIDreq = 82224;
                                                    //if (current_numeric_id == threadIDreq)
                                                    //if (i == 0)
                                                    //    std::cout << "Mod: " << reverseEnchantIDMap.at(enchant.first) << ", multiplied by " << multiplier << " due to artifact " << parameters.artifactSelection << "\n";
                                                }
                                            }



                                            /*
                for (const auto& enchant : enchant_lite_list)
                {
                    float multiplier{ 0.0f };
                    for (const auto& tag : artifact_lite_list.at(artifactID).tagMultipliers)
                    {
                        if (enchant.second.tagIDs.find(tag.first) != enchant.second.tagIDs.end())
                        {
                            multiplier = std::max(multiplier, tag.second);
                        }
                    }
                   for (const auto& unique : artifact_lite_list.at(artifactID).uniqueMultipliers)
                       if (enchant.first == unique.first)
                           multiplier = std::max(multiplier, unique.second);

                   if (multiplier == 0.0f)
                   {
                       weights[enchant.first] = enchant.second.weight;
                       continue;
                   }
                   weights[enchant.first] = static_cast<int>(enchant.second.weight * multiplier);
                }
                */
                                            std::vector<bool> mask(highestID + 1, false);
                                            for (const auto& enchant : enchant_lite_list)
                                                mask[enchant.second.enchantID] = true;

                                            std::vector<int> enchantIDs{};
                                            enchantIDs.reserve(enchant_lite_list.size());
                                            for (const auto& enchant : enchant_lite_list)
                                                enchantIDs.emplace_back(enchant.second.enchantID);
                                            std::sort(enchantIDs.begin(), enchantIDs.end());

                                            for(const auto& modID : threadEnchantLiteSubLists[i])
                                            {
                                                const auto& slot1_iterator = enchant_lite_list.at(modID);
                                                std::pair<double, double> FirstMaskOdds = maskRollOdds(weights, mask, slot1_iterator.enchantID);
                                                std::pair<double, double> SecondMaskOdds{};
                                                std::pair<double, double> ThirdMaskOdds{};
                                                std::pair<double, double> FourthMaskOdds{};

                                                if (mutuallyIncompatibleLiteMods.contains(modID))
                                                {
                                                    if (modID == desiredID)
                                                        threadMaskOdds += (FirstMaskOdds.first / FirstMaskOdds.second) * 100;
                                                    continue;
                                                }

                                                if (parameters.slotAmount - parameters.lockedModAmount > 1)
                                                {
                                                    const auto secondRollMask = cullMask(enchant_lite_list, slot1_iterator.excludeIDs, mask);

                                                    for (const auto& slot2_iterator : enchantIDs)
                                                    {
                                                        if (!secondRollMask[slot2_iterator])
                                                            continue;
                                                        if (slot2_iterator == slot1_iterator.enchantID)
                                                            continue;

                                                        SecondMaskOdds = maskRollOdds(weights, secondRollMask, slot2_iterator);
                                                        if (mutuallyIncompatibleLiteMods.contains(slot2_iterator))
                                                        {
                                                            if (slot1_iterator.enchantID == desiredID || slot2_iterator == desiredID)
                                                                threadMaskOdds += ((FirstMaskOdds.first * SecondMaskOdds.first) / (FirstMaskOdds.second * SecondMaskOdds.second)) * 100;
                                                            continue;
                                                        }
                                                        if (parameters.slotAmount - parameters.lockedModAmount > 2)
                                                        {
                                                            const auto thirdRollMask = cullMask(enchant_lite_list, enchant_lite_list.at(slot2_iterator).excludeIDs, secondRollMask);

                                                            for (const auto& slot3_iterator : enchantIDs)
                                                            {
                                                                if (!thirdRollMask[slot3_iterator])
                                                                    continue;
                                                                if (slot3_iterator == slot1_iterator.enchantID || slot3_iterator == slot2_iterator)
                                                                    continue;

                                                                ThirdMaskOdds = maskRollOdds(weights, thirdRollMask, slot3_iterator);
                                                                if (mutuallyIncompatibleLiteMods.contains(slot3_iterator))
                                                                {
                                                                    if (slot1_iterator.enchantID == desiredID || slot2_iterator == desiredID || slot3_iterator == desiredID)
                                                                        threadMaskOdds += ((FirstMaskOdds.first * SecondMaskOdds.first * ThirdMaskOdds.first) / (FirstMaskOdds.second * SecondMaskOdds.second * ThirdMaskOdds.second)) * 100;
                                                                    continue;
                                                                }
                                                                if (parameters.slotAmount - parameters.lockedModAmount > 3)
                                                                {
                                                                    const auto fourthRollMask = cullMask(enchant_lite_list, enchant_lite_list.at(slot3_iterator).excludeIDs, thirdRollMask);

                                                                    for (const auto& slot4_iterator : enchantIDs)
                                                                    {
                                                                        if (!fourthRollMask[slot4_iterator])
                                                                            continue;
                                                                        if (slot4_iterator == slot1_iterator.enchantID || slot4_iterator == slot2_iterator || slot4_iterator == slot3_iterator)
                                                                            continue;

                                                                        FourthMaskOdds = maskRollOdds(weights, fourthRollMask, slot4_iterator);
                                                                        if (slot1_iterator.enchantID == desiredID || slot2_iterator == desiredID || slot3_iterator == desiredID || slot4_iterator == desiredID)
                                                                            threadMaskOdds += ((FirstMaskOdds.first * SecondMaskOdds.first * ThirdMaskOdds.first * FourthMaskOdds.first) / (FirstMaskOdds.second * SecondMaskOdds.second * ThirdMaskOdds.second * FourthMaskOdds.second)) * 100;
                                                                    }
                                                                }
                                                                else if (slot1_iterator.enchantID == desiredID || slot2_iterator == desiredID || slot3_iterator == desiredID)
                                                                    threadMaskOdds += ((FirstMaskOdds.first * SecondMaskOdds.first * ThirdMaskOdds.first) / (FirstMaskOdds.second * SecondMaskOdds.second * ThirdMaskOdds.second)) * 100;
                                                            }
                                                        }
                                                        else if (slot1_iterator.enchantID == desiredID || slot2_iterator == desiredID)
                                                            threadMaskOdds += ((FirstMaskOdds.first * SecondMaskOdds.first) / (FirstMaskOdds.second * SecondMaskOdds.second)) * 100;
                                                    }
                                                }
                                                else if (slot1_iterator.enchantID == desiredID)
                                                    threadMaskOdds += (FirstMaskOdds.first / FirstMaskOdds.second) * 100;
                                            }
                                            return threadMaskOdds;
                                        }));
    }
    double threadOddsTotal{};
    for (int i{}; i < threads.size(); i++)
    {
        double tempThread = threads[i].get();
        threadOddsTotal += tempThread;
    }

    return threadOddsTotal;
}


inline void exportOdds(const std::unordered_map<std::string, Enchant>& enchant_list, Parameters& paramObject, const std::unordered_map <std::string, Artifacts>& artifact_list, const std::map<std::string_view, int>& tagToIntMap,
                       const std::map<std::string_view, int>& artifactToIntMap, const std::map<std::string_view, int>& awakenToIntMap, const std::map<std::string_view, int>& uniqueToIntMap,
                       const std::multimap<std::string, std::string>& awakenedItemMap, const std::unordered_map<int, std::string>& reverseEnchantIDMap, const std::unordered_map<std::string,bool>& modButtonInformer)
{
    paramObject.blockSignals(true);

    double odds{};
    std::string concatenatedParams{};

    std::string outputFileName = paramObject.itemType;
    if (!paramObject.specialBaseTypes.empty())
        for (const auto& tag : paramObject.specialBaseTypes)
            outputFileName += ("_" + tag);
    outputFileName += ".txt";
    std::ofstream outFile(outputFileName, std::ios::app);
    std::unordered_map<std::string,Enchant> culledList{};

    for (const auto& mod : modButtonInformer)
    {
        if (mod.second == true)
            culledList.emplace(mod.first,enchant_list.at(mod.first));
    }
    int resultsCached{};
    int size = culledList.size();
    qDebug() << "Caching results for " << size << "enchants. :: " << paramObject.itemType << " :: " << paramObject.slotAmount << "\n\n";
    for (const auto& enchant : culledList)
    {
        paramObject.desiredMod = enchant.first;
        for (const auto& artifact : artifact_list)
        {
            paramObject.artifactSelection = artifact.first;
            odds = createTrees(enchant_list,artifact_list,paramObject,tagToIntMap,artifactToIntMap,awakenToIntMap,uniqueToIntMap,awakenedItemMap,reverseEnchantIDMap);
            concatenatedParams = concatenateParams(enchant_list, paramObject, tagToIntMap, artifactToIntMap, awakenToIntMap, awakenedItemMap);
            outFile << concatenatedParams << "," << odds << "\n";
        }
        resultsCached++;
        outFile.flush();
        qDebug() <<  resultsCached << " of " << size <<'\n';
    }
    qDebug() << "\nNumber of results cached: " << resultsCached << "\n\n";
    paramObject.blockSignals(false);
}



/*
inline void export4slotAwakens(const std::unordered_map<std::string, Enchant>& enchant_list, const std::unordered_map <std::string, Artifacts>& artifact_list, const std::map<std::string_view, int>& tagToIntMap, const std::map<std::string_view, int>& artifactToIntMap, const std::map<std::string_view, int>& awakenToIntMap, const std::map<std::string_view, int>& uniqueToIntMap, const std::map<std::string, std::string>& awakenedItemMap)
{
    std::cout << "Beginning export of all possible 4-slot awakened mod rolls.\n";

    Parameters paramObject{};
    paramObject.slotAmount = 4;
    paramObject.lockedModAmount = 0;
    paramObject.threadAmount = std::thread::hardware_concurrency();

    std::ofstream outFile("AWAKENS.txt", std::ios::app);
    double odds{};
    std::string concatenatedParams{};


    for (const auto& mod : awakenedItemMap)
    {
        paramObject.itemName = mod.first;
        paramObject.desiredMod = mod.second;
        paramObject.itemType = *enchant_list.at(mod.second).item_tags.begin();

        for(const auto& artifact : artifact_list)
        {
            paramObject.artifactSelection = artifact.first;
            odds = createTrees(enchant_list, artifact_list, paramObject, tagToIntMap, artifactToIntMap, awakenToIntMap, uniqueToIntMap, awakenedItemMap);
            concatenatedParams = concatenateParams(enchant_list, paramObject, tagToIntMap, artifactToIntMap, awakenToIntMap, awakenedItemMap);
            outFile << concatenatedParams << "," << odds << "\n";
        }

        paramObject.artifactSelection = "na";
        odds = createTrees(enchant_list, artifact_list, paramObject, tagToIntMap, artifactToIntMap, awakenToIntMap, uniqueToIntMap, awakenedItemMap);
        concatenatedParams = concatenateParams(enchant_list, paramObject, tagToIntMap, artifactToIntMap, awakenToIntMap, awakenedItemMap);
        outFile << concatenatedParams << "," << odds << "\n";

        std::cout << "Completed export for awakened mod " << paramObject.desiredMod << " with item name " << paramObject.itemName << ".\n";
    }

}
*/
inline void loadEnchants(std::unordered_map<std::string, Enchant>& enchant_list, std::set<std::string>& allPossibleTags, std::set<std::string>& allAwakens, std::set<std::string>& allUniques)
{
    std::filesystem::path thisPath = std::filesystem::current_path();
    thisPath /= "Enchantment Documents";
    static std::vector<std::filesystem::path>file_list{};
    int fileListIncrementer = file_list.size();
    std::filesystem::path folder{ "Enchantment documents/" };
    for (const auto& entry : std::filesystem::directory_iterator(thisPath))
    {
        if (std::filesystem::path(entry.path()).extension() == ".txt")
        {
            file_list.emplace_back();
            file_list[fileListIncrementer].replace_filename(folder /= entry.path().filename());
            folder = "Enchantment Documents/";

            std::cout << file_list[fileListIncrementer] << '\n';

            fileListIncrementer++;


        }
    }
    std::ifstream inf{};
    int enchantIDincrementer{};
    for (const auto& fileNum : file_list)
    {

        inf.close();
        inf.open(fileNum);

        if (!inf)
        {
            std::cerr << "oopsie woopsie! text file did not load.";
        }

        int propertyIncrementer{ 0 };
        bool readyToCreate{ true };

        std::string strTest{};
        std::string tempMapReference{};

        while (std::getline(inf, strTest))

            if ((strTest[0] == '#' and strTest[1] == '#') or strTest.empty())
            {
                continue;
            }
            else
            {
                strTest.erase(strTest.begin());
                strTest.pop_back();

                if (readyToCreate)
                {
                    enchant_list.emplace(strTest, fileNum.string());
                    enchant_list[strTest].enchantID = enchantIDincrementer;
                    enchantIDincrementer++;
                    tempMapReference = strTest;

                    readyToCreate = false;

                }
                if (strTest == "**********")
                {
                    propertyIncrementer = 0;
                    readyToCreate = true;
                }
                else
                {
                    switch (propertyIncrementer)
                    {
                    case 0:
                        enchant_list[tempMapReference].name = strTest;
                        break;
                    case 1:
                        enchant_list[tempMapReference].description = strTest;
                        break;
                    case 2:
                        enchant_list[tempMapReference].weight = std::stol(strTest);
                        break;
                    case 3:
                    {
                        std::istringstream taglist(strTest);
                        for (std::string tag; std::getline(taglist, tag, ',');)
                        {
                            enchant_list[tempMapReference].tags.emplace(tag);
                            allPossibleTags.emplace(tag);
                        }
                        break;
                    }
                    case 4:
                    {
                        std::istringstream excludelist(strTest);
                        for (std::string tag; std::getline(excludelist, tag, ',');)
                        {
                            enchant_list[tempMapReference].excludes.emplace(tag);
                            if (tag == "AWAKENED"sv)
                                allAwakens.emplace(enchant_list[tempMapReference].name);
                            if (tag == "UNIQUE"sv)
                                allUniques.emplace(enchant_list[tempMapReference].name);
                        }
                        break;
                    }
                    case 5:
                    {
                        std::istringstream item_tagList(strTest);
                        for (std::string tag; std::getline(item_tagList, tag, ',');)
                        {
                            enchant_list[tempMapReference].item_tags.emplace(tag);
                        }
                        break;
                    }
                    case 6:
                    {
                        std::istringstream specialBaseRequirementList(strTest);
                        for (std::string req; std::getline(specialBaseRequirementList, req, ',');)
                        {
                            enchant_list[tempMapReference].specialBaseRequirement.emplace(req);
                        }
                        break;
                    }
                    case 7:
                    {
                        std::istringstream tierWeightlist(strTest);
                        int i{ 0 };
                        for (std::string tag; std::getline(tierWeightlist, tag, ',');)
                        {
                            i++;
                            enchant_list[tempMapReference].weightDistribution.emplace(i, std::stod(tag));
                        }
                        break;
                    }
                    }
                    propertyIncrementer++;
                }
            }
    }

}
inline void loadArtifacts(std::unordered_map<std::string, Artifacts>& artifact_list)
{
    std::ifstream inf{};
    std::filesystem::path artifactPath = std::filesystem::current_path() /= "Artifacts";
    std::vector<std::filesystem::path> artifactFileList{};
    for (const auto& entry : std::filesystem::directory_iterator(artifactPath))
    {
        if (std::filesystem::path(entry.path()).extension() == ".txt")
        {
            artifactFileList.emplace_back();
            artifactFileList[artifactFileList.size() - 1].replace_filename(artifactPath /= entry.path().filename());

            std::cout << artifactFileList[artifactFileList.size() - 1] << '\n';
            std::cout << "Successfully added artifact file " << artifactFileList[artifactFileList.size() - 1] << " to artifact file list. \n";
        }
    }
    for (const auto& artifactFile : artifactFileList)
    {
        inf.close();
        inf.open(artifactFile);

        if (!inf)
        {
            std::cerr << "oopsie woopsie! artifact text file did not load.";
        }

        std::string strTest{};
        std::string tempMapReference{};
        int propertyIncrementer{ 0 };
        bool readyToCreate{ true };

        while (std::getline(inf, strTest))
        {
            if ((strTest[0] == '#' and strTest[1] == '#') or strTest.empty())
            {
                continue;
            }
            else
            {
                strTest.erase(strTest.begin());
                strTest.pop_back();

                if (readyToCreate)
                {
                    artifact_list.emplace(strTest, Artifacts{});
                    tempMapReference = strTest;
                    readyToCreate = false;
                }
                if (strTest == "**********")
                {
                    propertyIncrementer = 0;
                    readyToCreate = true;
                }
                else
                {
                    switch (propertyIncrementer)
                    {
                    case 0:
                        artifact_list[tempMapReference].name = strTest;
                        break;
                    case 1:
                        artifact_list[tempMapReference].description = strTest;
                        break;
                    case 2:
                    {
                        std::istringstream costStream(strTest);
                        std::string costString;
                        bool flipper{ true };
                        for (std::string tag; std::getline(costStream, tag, ',');)
                        {
                            if (flipper)
                            {
                                costString = tag;
                                flipper = false;
                            }
                            else
                            {
                                artifact_list[tempMapReference].dustCost = { costString, std::stof(tag) };
                                flipper = true;
                            }
                        }
                        break;
                    }
                    case 3:
                    {
                        std::istringstream poolList(strTest);
                        for (std::string tag; std::getline(poolList, tag, ',');)
                        {
                            artifact_list[tempMapReference].pools.emplace(tag);
                        }
                        break;
                    }
                    default:
                    {
                        std::istringstream tagList(strTest);
                        auto multData = std::make_shared<ArtifactData>();
                        bool accessingExcludes{ false };

                        for (std::string tag; std::getline(tagList, tag, ',');)
                        {
                            if (std::isdigit(tag.front()))
                            {
                                multData->multiplier = std::stod(tag);
                                accessingExcludes = true;
                            }
                            else if (!accessingExcludes)
                            {
                                multData->tags.emplace(tag);
                            }
                            else if (accessingExcludes)
                            {
                                multData->excludes.emplace(tag);
                            }
                        }
                        for (const auto& tag : multData->tags)
                            artifact_list[tempMapReference].multiplierData.emplace(tag,multData);
                        break;
                    }
                    }
                    propertyIncrementer++;
                }
            }
        }

    }
    std::cout << "Number of artifacts loaded: " << artifact_list.size() << "\n\n";

}
inline void loadAwakens(std::multimap<std::string, std::string>& awakenedItemMap)
{
    std::ifstream inf{};
    std::filesystem::path awakenedItemPath = std::filesystem::current_path() /= "Awakened Items";
    awakenedItemPath /= "awakenedItems.txt";
    std::cout << "Awakened item file path: " << awakenedItemPath << "\n";

    inf.open(awakenedItemPath);
    if (!inf)
    {
        std::cerr << "oops! awakened items text file did not load.";
    }
    std::string strTest{};
    while (std::getline(inf, strTest))
    {
        if ((strTest[0] == '#' and strTest[1] == '#') or strTest.empty())
        {
            continue;
        }
        else
        {
            strTest.erase(strTest.begin());
            strTest.pop_back();

            std::istringstream line(strTest);
            std::string itemName;
            std::string awakenName;
            std::getline(line, itemName, ',');
            std::getline(line, awakenName, ',');
            awakenedItemMap.emplace(itemName, awakenName);
        }
    }
    inf.close();
}
inline void buildIntMaps(const std::unordered_map<std::string, Enchant>& enchant_list, const std::unordered_map<std::string, Artifacts>& artifact_list, std::map<std::string_view, int>& tagToIntMap, std::map<std::string_view, int>& artifactToIntMap, std::map<std::string_view, int>& awakenToIntMap, std::map<std::string_view, int>& uniqueToIntMap, const std::set<std::string>& allPossibleTags, const std::set<std::string>& allUniques, const std::set<std::string>& allAwakens)
{
    int tagCounter{};
    for (const auto& tag : allPossibleTags)
    {
        tagToIntMap[tag] = tagCounter;
        tagCounter++;
    }

    int artifactCounter{};
    for (const auto& artifact : artifact_list)
    {
        artifactToIntMap[artifact.first] = artifactCounter;
        artifactCounter++;
    }

    for (const auto& mod : allAwakens)
        awakenToIntMap.emplace(mod, enchant_list.at(mod).enchantID);

    for (const auto& mod : allUniques)
        uniqueToIntMap.emplace(mod, enchant_list.at(mod).enchantID);
}
inline void buildCache(std::unordered_map<std::string, double>& oddsCache)
{
    std::filesystem::path cachePath = std::filesystem::current_path() /= "Cached Odds";
    std::ifstream inf{};
    std::string strTest{};
    std::filesystem::path folder = "Cached Odds/";



    for (const auto& entry : std::filesystem::directory_iterator(cachePath))
    {
        inf.open(folder /= entry.path().filename());
        folder = "Cached Odds/";
        if (!inf)
        {
            qDebug() << "oopsie woopsie! cached odds file did not load.\n";
            qDebug() << "Cache path: " << &cachePath << '\n';
        }

        while (std::getline(inf, strTest))
        {
            if (strTest.empty())
            {
                continue;
            }
            else
            {
                std::istringstream line(strTest);
                std::string params;
                std::string odds;
                std::getline(line, params, ',');
                std::getline(line, odds, ',');
                oddsCache.emplace(params, std::stod(odds));
            }
        }
        inf.close();
    }
}
inline std::unordered_set<std::string> updateButtonMods(const std::unordered_map<std::string,Enchant>& enchant_list, std::unordered_set<std::string> enchantStringList, const Parameters& paramObject)
{
    for (auto i = enchantStringList.begin(), last= enchantStringList.end(); i != last;)
    {
        if (!enchant_list.at(*i).item_tags.contains(paramObject.itemType))
            i = enchantStringList.erase(i);
        else if (!enchant_list.at(*i).required_item.contains(paramObject.itemName))
            i = enchantStringList.erase(i);
        else
            ++i;
    }

    for (const auto& lockedMod : paramObject.lockedMods)
    {
        for (const auto& lockTag : enchant_list.at(lockedMod).excludes)
        {
            for (auto i = enchantStringList.begin(), last= enchantStringList.end(); i != last;)
            {
                if (enchant_list.at(*i).excludes.contains(lockTag))
                {
                    i = enchantStringList.erase(i);
                }
                else ++i;
            }
        }
    }
    return enchantStringList;
}

inline double roundDouble( double x, int n )
{
    std::stringstream ss;
    ss << std::scientific << std::setprecision( n - 1 ) << x;
    return stod( ss.str() );
}

inline void buildEnchantToIconMap(const std::unordered_map<std::string,Enchant>& enchant_list, std::unordered_map<std::string,std::string>& enchantToIconMap)
{
    for (const auto& enchant : enchant_list)
    {
        if (enchant.second.tags.contains("AWAKENED"))
        {
            enchantToIconMap.emplace(enchant.first,enchant.first);
        }
        else if (enchant.second.tags.contains("UNIQUE"))
        {
            if (enchant.second.weight == 750)
                enchantToIconMap.emplace(enchant.first,"UNIQUEFROZEN");
            else
                enchantToIconMap.emplace(enchant.first,"UNIQUE");
        }
        else if (enchant.second.tags.contains("NEO_ALIEN"))
            enchantToIconMap.emplace(enchant.first,"NEO_ALIEN");
        else if (enchant.second.tags.contains("ALIEN"))
            enchantToIconMap.emplace(enchant.first,"ALIEN");
        else
        {
            if (enchant.second.tags.contains("SINGLESTAT"))
                enchantToIconMap.emplace(enchant.first,"SINGLESTAT");
            else if (enchant.second.tags.contains("DUALSTAT"))
                enchantToIconMap.emplace(enchant.first,"DUALSTAT");
            else if (enchant.second.tags.contains("PROC"))
                enchantToIconMap.emplace(enchant.first,"PROC");
            else if (enchant.second.tags.contains("REWARDBONUS"))
                enchantToIconMap.emplace(enchant.first,"REWARDBONUS");
            else if (enchant.second.tags.contains("DAMAGE"))
                enchantToIconMap.emplace(enchant.first,"DAMAGE");
            else if (enchant.second.tags.contains("WEAPONRANGE"))
                enchantToIconMap.emplace(enchant.first,"WEAPONRANGE");
            else if (enchant.second.tags.contains("CASTING"))
                enchantToIconMap.emplace(enchant.first,"CASTING");
            else if (enchant.second.tags.contains("MANAREGEN"))
                enchantToIconMap.emplace(enchant.first,"MANAREGEN");
            else if (enchant.second.tags.contains("LIFEREGEN"))
                enchantToIconMap.emplace(enchant.first,"LIFEREGEN");
            else if (enchant.second.tags.contains("DAMAGERESISTANCE"))
                enchantToIconMap.emplace(enchant.first,"DAMAGERESISTANCE");
            else if (enchant.second.tags.contains("DUALREWARDBONUS"))
                enchantToIconMap.emplace(enchant.first,"DUALREWARDBONUS");
            else
                enchantToIconMap.emplace(enchant.first,"error");
        }
    }
}
#endif // CLASSES_FUNCTIONS_H
