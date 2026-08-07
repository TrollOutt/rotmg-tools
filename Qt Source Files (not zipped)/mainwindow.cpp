#include "mainwindow.h"
#include "ui_mainwindow.h"
//#include "Enchant.h"
#include <map>
#include <QCompleter>
#include <QLineEdit>
#include <QStandardItemModel>
#include <QMouseEvent>
#include <QHBoxLayout>
#include <QLabel>
#include <QTimer>
#include <QStyledItemDelegate>

Parameters paramObject;
std::unordered_map<std::string,Results> resultObject;

void updateLockedMods(QComboBox& locked1, QComboBox& locked2, QComboBox& locked3, Parameters& paramObject);

void updateCompleter(QComboBox& comboBox)
{
    QCompleter *completer = comboBox.completer();
    completer->setFilterMode(Qt::MatchContains);
    completer->setCaseSensitivity(Qt::CaseInsensitive);
    completer->setCompletionMode(QCompleter::PopupCompletion);
    completer->setMaxVisibleItems(20);
    completer->popup()->setIconSize(QSize(54,54));
    completer->popup()->setStyleSheet("QAbstractItemView { font-size: 18pt; background-color: #212121; } QAbstractItemView::item {max-height: 60px; }");
    //comboBox.setCompleter(completer);
    qDebug() << "updateCompleter finished execution.\n";
}

void checkCalculationValidity(QPushButton *CalculateButton, const Parameters& paramObject)
{
    bool isValid(true);

    if (paramObject.itemType.empty())
        isValid = false;
    else if  (paramObject.dustType.empty())
        isValid = false;
    else if (paramObject.desiredMod.empty())
        isValid = false;
    else if (paramObject.slotAmount == 0)
        isValid = false;

    if (isValid)
        CalculateButton->setEnabled(true);
    else
        CalculateButton->setEnabled(false);
}

void checkSlotValidity(QComboBox *locked1Widget,QComboBox *locked2Widget, QComboBox *locked3Widget,QPushButton *clear1Widget, QPushButton *clear2Widget, QPushButton *clear3Widget, const Parameters& paramObject)
{
    if (paramObject.slotAmount == 4)
    {
        locked1Widget->setEnabled(true);
        locked1Widget->lineEdit()->setPlaceholderText("<empty>");
        clear1Widget->setEnabled(true);
        //clear1Widget->show();

        locked2Widget->setEnabled(true);
        locked2Widget->lineEdit()->setPlaceholderText("<empty>");
        clear2Widget->setEnabled(true);
        //clear2Widget->show();

        locked3Widget->setEnabled(true);
        locked3Widget->lineEdit()->setPlaceholderText("<empty>");
        clear3Widget->setEnabled(true);
        //clear3Widget->show();
    }
    else if (paramObject.slotAmount == 3)
    {
        locked1Widget->setEnabled(true);
        locked1Widget->lineEdit()->setPlaceholderText("<empty>");
        clear1Widget->setEnabled(true);
        //clear1Widget->show();

        locked2Widget->setEnabled(true);
        locked2Widget->lineEdit()->setPlaceholderText("<empty>");
        clear2Widget->setEnabled(true);
        //clear2Widget->show();

        locked3Widget->setEnabled(false);
        locked3Widget->lineEdit()->setPlaceholderText("~~");
        clear3Widget->setEnabled(false);
        //clear3Widget->hide();
    }
    else if (paramObject.slotAmount == 2)
    {
        locked1Widget->setEnabled(true);
        locked1Widget->lineEdit()->setPlaceholderText("<empty>");
        clear1Widget->setEnabled(true);
        //clear1Widget->show();

        locked2Widget->setEnabled(false);
        locked2Widget->lineEdit()->setPlaceholderText("~~");
        clear2Widget->setEnabled(false);
        //clear2Widget->hide();

        locked3Widget->setEnabled(false);
        locked3Widget->lineEdit()->setPlaceholderText("~~");
        clear3Widget->setEnabled(false);
        //clear3Widget->hide();
    }
    else if (paramObject.slotAmount == 1)
    {
        locked1Widget->setEnabled(false);
        locked1Widget->lineEdit()->setPlaceholderText("~~");
        clear1Widget->setEnabled(false);
        //clear1Widget->hide();

        locked2Widget->setEnabled(false);
        locked2Widget->lineEdit()->setPlaceholderText("~~");
        clear2Widget->setEnabled(false);
        //clear2Widget->hide();

        locked3Widget->setEnabled(false);
        locked3Widget->lineEdit()->setPlaceholderText("~~");
        clear3Widget->setEnabled(false);
        //clear3Widget->hide();
    }
}

void updateInformer(QComboBox& comboBox, const std::unordered_map<std::string,Enchant>& enchant_list, const Parameters& paramObject, std::unordered_map<std::string,bool>& modButtonInformer, const std::multimap<std::string,std::string>& awakenedItemMap)
{
    auto range = awakenedItemMap.equal_range(paramObject.itemName);

    for (auto& mod : modButtonInformer)
    {
        bool failed{false};

        if (!enchant_list.at(mod.first).item_tags.contains(paramObject.itemType))
        {
            failed = true;
           // qDebug() << "mod.second flagged false at: itemType\n";
        }
        else if (enchant_list.at(mod.first).tags.contains("AWAKENED"))
        {
            bool isValid{false};

            for (auto i = range.first; i!= range.second; ++i)
            {
                if (mod.first == i->second)
                    isValid = true;
            }
            if (!isValid)
                failed = true;
           // qDebug() << "mod.second flagged false at: itemName\n";
        }
        if (!failed)
        {
            for (const auto& tag : enchant_list.at(mod.first).specialBaseRequirement)
            {
                if (!paramObject.specialBaseTypes.contains(tag) && tag != "ALIEN" )
                {
                    failed = true;
                    break;
                }
            }

            if (!paramObject.desiredMod.empty())
            {
                for (const auto& tag : enchant_list.at(mod.first).excludes)
                {
                    if (enchant_list.at(paramObject.desiredMod).excludes.contains(tag))
                    {
                        // qDebug() << "mod.second flagged false at: desiredMod conflict\n";
                        failed = true;
                        break;
                    }
                }
            }
            if (!paramObject.lockedMods.empty())
            {
                for (const auto& lockedMod : paramObject.lockedMods)
                {
                    if (comboBox.currentText() == lockedMod)
                        continue;

                    for (const auto& lockedTag : enchant_list.at(lockedMod).excludes)
                    {
                        if (enchant_list.at(mod.first).excludes.contains(lockedTag))
                        {
                            // qDebug() << "mod.second flagged false at: lockedMods conflict\n";
                            failed = true;
                            break;
                        }
                    }
                }
            }
        }
        if (failed)
            mod.second = false;
        else
            mod.second = true;
    }
    return;
}

void updateDesiredLockInformer(const std::unordered_map<std::string,Enchant>& enchant_list, const Parameters& paramObject, std::unordered_map<std::string,bool>& modButtonInformer, const std::multimap<std::string,std::string>& awakenedItemMap)
{
    auto range = awakenedItemMap.equal_range(paramObject.itemName);

    for (auto& mod : modButtonInformer)
    {
        bool failed{false};

        if (!enchant_list.at(mod.first).item_tags.contains(paramObject.itemType))
        {
            failed = true;
            // qDebug() << "mod.second flagged false at: itemType\n";
        }
        else if (enchant_list.at(mod.first).tags.contains("AWAKENED"))
        {
            bool isValid{false};

            for (auto i = range.first; i!= range.second; ++i)
            {
                if (mod.first == i->second)
                    isValid = true;
            }
            if (!isValid)
                failed = true;
            // qDebug() << "mod.second flagged false at: itemName\n";
        }

        if (!failed)
        {
            for (const auto& tag : enchant_list.at(mod.first).specialBaseRequirement)
            {
                if (!paramObject.specialBaseTypes.contains(tag) && tag != "ALIEN" )
                {
                    failed = true;
                    break;
                }
            }

            if (!paramObject.lockedMods.empty())
            {
                for (const auto& lockedMod : paramObject.lockedMods)
                {
                    for (const auto& lockedTag : enchant_list.at(lockedMod).excludes)
                    {
                        if (enchant_list.at(mod.first).excludes.contains(lockedTag))
                        {
                            // qDebug() << "mod.second flagged false at: lockedMods conflict\n";
                            failed = true;
                            break;
                        }
                    }
                }
            }
        }
        if (failed)
            mod.second = false;
        else
            mod.second = true;
    }
    return;
}

void updateDesiredInformer (const std::unordered_map<std::string,Enchant>& enchant_list, const Parameters& paramObject, std::unordered_map<std::string,bool>& desiredInformer, const std::multimap<std::string,std::string>& awakenedItemMap)
{
    auto range = awakenedItemMap.equal_range(paramObject.itemName);

    for (auto& mod : desiredInformer)
    {
        bool failed{false};

        if (!enchant_list.at(mod.first).item_tags.contains(paramObject.itemType))
        {
            failed = true;
            // qDebug() << "mod.second flagged false at: itemType\n";
        }
        else if (enchant_list.at(mod.first).tags.contains("AWAKENED"))
        {
            bool isValid{false};

            for (auto i = range.first; i!= range.second; ++i)
            {
                if (mod.first == i->second)
                    isValid = true;
            }
            if (!isValid)
                failed = true;
            // qDebug() << "mod.second flagged false at: itemName\n";
        }
        if (!failed)
        {
            for (const auto& tag : enchant_list.at(mod.first).specialBaseRequirement)
            {
                if (!paramObject.specialBaseTypes.contains(tag) && tag != "ALIEN" )
                {
                    failed = true;
                    break;
                }
            }
        }
        if (failed)
            mod.second = false;
        else
            mod.second = true;
    }
    return;
}



void updateButtonList(QComboBox& comboBox,QComboBox& otherBox1,QComboBox& otherBox2, std::unordered_map<std::string,bool>& modButtonInformer, const std::unordered_map<std::string,Enchant>& enchant_list, Parameters& paramObject,
                      const std::unordered_map<std::string,std::string>& enchantToIconMap, const std::multimap<std::string,std::string>& awakenedItemMap, const QHash<QString,QIcon> &iconCache)
{
    comboBox.blockSignals(true);
    QString initialMod = comboBox.currentText();
    updateInformer(comboBox,enchant_list,paramObject,modButtonInformer,awakenedItemMap);
    comboBox.clear();

    //qDebug() << "Current widget: " << comboBox.objectName() << '\n';
    //qDebug() << "Current widget text: " << comboBox.currentText() << '\n';
    //qDebug() << "Current locked mods: ";
    //for (const auto& mod : paramObject.lockedMods)
    //    qDebug() << mod << ", ";
    //qDebug() << "\n\n";

    for (const auto& mod : modButtonInformer)
    {
        if (mod.second)
        {
            QString iconPath{":/Enchantment Icons/GUI Files/Enchantment Icons/" + QString::fromStdString(enchantToIconMap.at(mod.first)) + ".png"};
            comboBox.addItem(iconCache.value(iconPath),QString::fromStdString(mod.first));
            //QIcon icon{iconPath};
            //comboBox.addItem(icon,QString::fromStdString(mod.first));
        //qDebug() << "item added: " << mod.first <<'\n';
        }
    }
    updateCompleter(comboBox);
    comboBox.model()->sort(0,Qt::AscendingOrder);
    comboBox.setCurrentIndex(comboBox.findText(initialMod));
    comboBox.blockSignals(false);

    updateLockedMods(comboBox,otherBox1,otherBox2,paramObject);

    qDebug() << "updateButtonList has been executed.\n";
    return;
}

void updateDesiredList(QComboBox& comboBox, std::unordered_map<std::string,bool>& modButtonInformer, std::unordered_map<std::string,bool>& desiredInformer, const std::unordered_map<std::string,Enchant>& enchant_list, Parameters& paramObject,
                       const std::unordered_map<std::string,std::string>& enchantToIconMap, const std::multimap<std::string,std::string>& awakenedItemMap, const QHash<QString,QIcon> &iconCache, const QHash<QString,QIcon> &iconPixmapCache)
{
    comboBox.blockSignals(true);
    QString initialMod = comboBox.currentText();
    updateDesiredInformer(enchant_list,paramObject,desiredInformer,awakenedItemMap);
    updateDesiredLockInformer(enchant_list,paramObject,modButtonInformer,awakenedItemMap);
    std::set<std::string> lockExcludes{};

    for (const auto& mod : desiredInformer)
    {
        if (mod.second == true && modButtonInformer.at(mod.first) == false)
            lockExcludes.emplace(mod.first);
    }

    comboBox.clear();
    for (const auto& mod : desiredInformer)
    {
        if (mod.second && !lockExcludes.contains(mod.first))
        {
            QString iconPath{":/Enchantment Icons/GUI Files/Enchantment Icons/" + QString::fromStdString(enchantToIconMap.at(mod.first)) + ".png"};
            comboBox.addItem(iconCache.value(iconPath),QString::fromStdString(mod.first));
            //QIcon icon{iconPath};
            //comboBox.addItem(icon,QString::fromStdString(mod.first));
            //qDebug() << "item added: " << mod.first <<'\n';
            /*
            if (lockExcludes.contains(mod.first))
            {
                int index = comboBox.count() - 1;
                //comboBox.model()->setData(comboBox.model()->index(index,0),QColor(Qt::red), Qt::ForegroundRole);
                comboBox.model()->setData(comboBox.model()->index(index,0),false,Qt::UserRole - 1);
            }
*/
        }
    }
    //updateCompleter(comboBox);
    comboBox.model()->sort(0,Qt::AscendingOrder);
    for (const auto& mod : lockExcludes)
    {
        QString iconPath{":/Enchantment Icons/GUI Files/Enchantment Icons/" + QString::fromStdString(enchantToIconMap.at(mod)) + ".png"};
        //QIcon preIcon{iconPath};
        //QPixmap pixmap = iconCache.value(iconPath).pixmap(QSize(54,54),QIcon::Disabled);
        //QIcon icon{pixmap};

        comboBox.addItem(iconPixmapCache.value(iconPath),QString::fromStdString(mod));
        comboBox.model()->setData(comboBox.model()->index(comboBox.count() - 1,0),QColor(128,128,128), Qt::ForegroundRole);
    }
    updateCompleter(comboBox);

    comboBox.setCurrentIndex(comboBox.findText(initialMod));
    if (comboBox.findText(initialMod) == -1)
        paramObject.setDesired("");
    comboBox.blockSignals(false);

    qDebug() << "updateDesiredList has been executed. current index set to: " << comboBox.findText(initialMod);
    return;
}

void updateLists(QComboBox& desiredBox, QComboBox& lockedBox1,QComboBox& lockedBox2,QComboBox& lockedBox3, std::unordered_map<std::string,bool>& modButtonInformer, std::unordered_map<std::string,bool>& desiredInformer, const std::unordered_map<std::string,Enchant>& enchant_list, Parameters& paramObject,
                 const std::unordered_map<std::string,std::string>& enchantToIconMap, const std::multimap<std::string,std::string>& awakenedItemMap, const QHash<QString,QIcon> &iconCache, const QHash<QString,QIcon>& iconPixmapCache)
{
    lockedBox1.blockSignals(true);
    lockedBox2.blockSignals(true);
    lockedBox3.blockSignals(true);
    desiredBox.blockSignals(true);
    paramObject.blockSignals(true);

    updateDesiredList(desiredBox,modButtonInformer,desiredInformer,enchant_list,paramObject,enchantToIconMap,awakenedItemMap, iconCache, iconPixmapCache);
    updateButtonList(lockedBox1,lockedBox2,lockedBox3,modButtonInformer,enchant_list,paramObject,enchantToIconMap,awakenedItemMap, iconCache);
    updateButtonList(lockedBox2,lockedBox1,lockedBox3,modButtonInformer,enchant_list,paramObject,enchantToIconMap,awakenedItemMap, iconCache);
    updateButtonList(lockedBox3,lockedBox1,lockedBox2,modButtonInformer,enchant_list,paramObject,enchantToIconMap,awakenedItemMap, iconCache);

    lockedBox1.blockSignals(false);
    lockedBox2.blockSignals(false);
    lockedBox3.blockSignals(false);
    desiredBox.blockSignals(false);
    paramObject.blockSignals(true);
}

void updateLockedMods(QComboBox& locked1, QComboBox& locked2, QComboBox& locked3, Parameters& paramObject)
{
    std::unordered_set<std::string> lockedMods{};

    if (!locked1.currentText().isEmpty())
        lockedMods.emplace(locked1.currentText().toStdString());
    if (!locked2.currentText().isEmpty())
        lockedMods.emplace(locked2.currentText().toStdString());
    if (!locked3.currentText().isEmpty())
        lockedMods.emplace(locked3.currentText().toStdString());
    paramObject.setLockedMods(lockedMods);
    paramObject.setLockedAmount(lockedMods.size());
}

void populateResultsTable(const std::unordered_map<std::string,Results>& resultObject, QTableWidget& resultsWidget,const Parameters& paramObject, const std::unordered_map<std::string,Artifacts>& artifact_list)
{
    resultsWidget.setSortingEnabled(false);
    resultsWidget.setRowCount(0);
    resultsWidget.setRowCount(resultObject.size());
    int i{0};
    for (const auto& entry : resultObject)
    {
        QString artIconPath{":/Artifact Icons/GUI Files/Artifact Icons/" + QString::fromStdString(entry.second.artifact) + ".png"};
        QString artMiniIconPath{":/Artifact Icons/GUI Files/Artifact Icons/" + QString::fromStdString(entry.second.artifact) + "-div2.png"};
        QString dustIconPath{":/Dust Types/GUI Files/Dust Types/" + QString::fromStdString(paramObject.dustType) + "-div2.png"};
        QString altDustIconPath{":/Dust Types/GUI Files/Dust Types/" + QString::fromStdString(artifact_list.at(entry.second.artifact).dustCost.first) + "-div2.png"};
        QIcon icon(artIconPath);
        QIcon dustIcon(dustIconPath);
        QIcon altDustIcon(altDustIconPath);
        QIcon miniIcon(artMiniIconPath);

        //resultsWidget.insertRow(i);
        QTableWidgetItem *artifact = new QTableWidgetItem(icon,QString::fromStdString(entry.second.artifact));

        QTableWidgetItem *odds = new QTableWidgetItem();
        odds->setData(Qt::DisplayRole, roundDouble(entry.second.odds,4));
        odds->setForeground(Qt::transparent);
        QLabel *oddsLabel = new QLabel(QString::number(roundDouble(entry.second.odds,4)) + "%");
        oddsLabel->setAlignment(Qt::AlignCenter);

        QTableWidgetItem *dustCost = new QTableWidgetItem();
        dustCost->setData(Qt::DisplayRole, entry.second.dustCost.at(paramObject.dustType));

        dustCost->setForeground(Qt::transparent);
        dustCost->setIcon(dustIcon);

        std::string dustCostWComma{std::to_string(entry.second.dustCost.at(paramObject.dustType))};
        int dcLength = dustCostWComma.length();
        int insertPos = dcLength - 3;
        while (insertPos > 0)
        {
            dustCostWComma.insert(insertPos,",");
            insertPos -= 3;
        }
        QLabel *dustCostLabel = new QLabel(QString::fromStdString(dustCostWComma));

        QTableWidgetItem *dustCostArt = new QTableWidgetItem();
        dustCostArt->setIcon(altDustIcon);

        QLabel *dustCostArtLabel = new QLabel;

        if (artifact_list.at(entry.second.artifact).dustCost.first != "na" && dustIconPath != altDustIconPath)
        {
            dustCostArt->setData(Qt::DisplayRole, entry.second.dustCost.at(artifact_list.at(entry.second.artifact).dustCost.first));
            dustCostArt->setForeground(Qt::transparent);

            std::string dustCostArtWComma{std::to_string(entry.second.dustCost.at(artifact_list.at(entry.second.artifact).dustCost.first))};
            int dcaLength = dustCostArtWComma.length();
            int insertPos2 = dcaLength - 3;
            while (insertPos2 > 0)
            {
                dustCostArtWComma.insert(insertPos2,",");
                insertPos2 -= 3;
            }
            dustCostArtLabel->setText(QString::fromStdString(dustCostArtWComma));
        }
        else
        {
            dustCostArt->setText(" ~~");
        }

        QTableWidgetItem *avgRollAmount = new QTableWidgetItem(miniIcon, QString::number(entry.second.avgRollAmount));

        if (entry.second.odds == 0.0)
        {
            dustCost->setData(Qt::DisplayRole, "∞");
            if (artifact_list.at(entry.second.artifact).dustCost.first != "na")
            {
                dustCostArt->setData(Qt::DisplayRole, "∞");
                dustCostArt->setForeground(Qt::transparent);
            }
            dustCostLabel->setText("∞");
            dustCostArtLabel->setText("∞");
            avgRollAmount->setText("∞");
        }


        resultsWidget.setItem(i,0,artifact);
        resultsWidget.setItem(i,1,odds);
        resultsWidget.setCellWidget(i,1,oddsLabel);
        resultsWidget.setItem(i,2,dustCost);
        resultsWidget.setCellWidget(i,2,dustCostLabel);
        resultsWidget.setItem(i,3,dustCostArt);
        if (artifact_list.at(entry.second.artifact).dustCost.first != "na")
            resultsWidget.setCellWidget(i,3,dustCostArtLabel);
        resultsWidget.setItem(i,4,avgRollAmount);
        i++;
    }
    resultsWidget.sortByColumn(1,Qt::DescendingOrder);
    resultsWidget.horizontalHeader()->setSortIndicator(1,Qt::DescendingOrder);
    resultsWidget.setSortingEnabled(true);
}

void buildResultsList(const std::unordered_map<std::string, Enchant>& enchant_list, const std::unordered_map<std::string, Artifacts>& artifact_list, Parameters& paramObject,
                      const std::map<std::string_view, int>& tagToIntMap, const std::map<std::string_view, int>& artifactToIntMap, const std::map<std::string_view, int>& awakenToIntMap,
                      const std::map<std::string_view, int>& uniqueToIntMap, const std::multimap<std::string,std::string>& awakenedItemMap, std::unordered_map<std::string,Results>& resultObject,
                      const std::unordered_map<std::string, double>& oddsCache, QTableWidget& resultsWidget, const std::unordered_map<int,std::string>& reverseEnchantIDMap, QProgressBar *progressBar)
{
    paramObject.blockSignals(true);
    resultObject.clear();
    std::vector<double> baseCosts{0,50,65,80,100};
    double lockedMult = std::pow(2,paramObject.lockedModAmount);
    const std::unordered_map<int,double>& distribution = enchant_list.at(paramObject.desiredMod).weightDistribution;

    auto itemNameSave = paramObject.itemName;
    bool found{false};
    for (auto it = awakenedItemMap.equal_range(paramObject.itemName).first; it != awakenedItemMap.equal_range(paramObject.itemName).second; it++)
        if (paramObject.desiredMod == it->second)
            found = true;

    if (!found && paramObject.slotAmount == 4 && paramObject.lockedModAmount == 0)
        paramObject.itemName.clear();

    for (const auto& artifact : artifact_list)
    {
        paramObject.artifactSelection = artifact.first;
        resultObject.emplace(artifact.first,"");
        resultObject.at(artifact.first).artifact = artifact.first;

        double tieredMult{0};
        if (!enchant_list.at(paramObject.desiredMod).weightDistribution.empty())
        {
            for (const auto& tier : paramObject.tiers)
            {
                if (artifact.second.multiplierData.contains("TIER3"))
                {
                    if (tier == 4)
                        tieredMult = 1;
                    else
                        continue;
                }
                else if (artifact.second.multiplierData.contains("TIER2"))
                {
                    if (tier == 3)
                        tieredMult += (distribution.at(1) + distribution.at(2) + distribution.at(tier));
                    else if (tier == 4)
                        tieredMult += distribution.at(tier);
                    else
                        continue;
                }
                else if (artifact.second.multiplierData.contains("TIER1"))
                {
                    if (tier == 1)
                        continue;
                    else if (tier == 2)
                        tieredMult += (distribution.at(1) + distribution.at(tier));
                    else if (tier == 3)
                            tieredMult += distribution.at(tier);
                    else if (tier == 4)
                        tieredMult += distribution.at(tier);
                }
                else
                    tieredMult += distribution.at(tier);
            }
        }
        std::string oddsID = concatenateParams(enchant_list, paramObject, tagToIntMap, artifactToIntMap, awakenToIntMap, awakenedItemMap);
        //qDebug() << oddsID << "\n";
        if (paramObject.lockedModAmount == 0 && paramObject.slotAmount == 4)
        {
            if (oddsCache.contains(oddsID))
                resultObject.at(artifact.first).odds = oddsCache.at(oddsID);
            else
                resultObject.at(artifact.first).odds = createTrees(enchant_list,artifact_list,paramObject,tagToIntMap,artifactToIntMap,awakenToIntMap,uniqueToIntMap,awakenedItemMap,reverseEnchantIDMap);
        }
        else
            resultObject.at(artifact.first).odds = createTrees(enchant_list,artifact_list,paramObject,tagToIntMap,artifactToIntMap,awakenToIntMap,uniqueToIntMap,awakenedItemMap,reverseEnchantIDMap);
        if (enchant_list.at(paramObject.desiredMod).tags.contains("TIERED"))
        {
            resultObject.at(artifact.first).odds *= tieredMult;
        }

        if(resultObject.at(artifact.first).odds == 0.0)
        {
            resultObject.at(artifact.first).avgRollAmount = -1;
            resultObject.at(artifact.first).dustCost.at("Green") = -1;
            resultObject.at(artifact.first).dustCost.at("Red") = -1;
            resultObject.at(artifact.first).dustCost.at("Purple") = -1;
        }
        else
        {
            if (artifact.first == "No Artifact")
                resultObject.at(artifact.first).avgRollAmount = 0;
            else
                resultObject.at(artifact.first).avgRollAmount = std::ceil(0.5 * 100 / resultObject.at(artifact.first).odds);

        resultObject.at(artifact.first).dustCost.at(paramObject.dustType) = ( baseCosts[paramObject.slotAmount] * 100 / resultObject.at(artifact.first).odds  * lockedMult  );

        if (artifact.second.dustCost.first == "Green")
            resultObject.at(artifact.first).dustCost.at("Green") += (artifact.second.dustCost.second * 100 / resultObject.at(artifact.first).odds  * lockedMult );
        else if (artifact.second.dustCost.first == "Red")
            resultObject.at(artifact.first).dustCost.at("Red") += (artifact.second.dustCost.second * 100 / resultObject.at(artifact.first).odds  * lockedMult );
        else if (artifact.second.dustCost.first == "Purple")
            resultObject.at(artifact.first).dustCost.at("Purple") += (artifact.second.dustCost.second * 100 / resultObject.at(artifact.first).odds  * lockedMult );
        }
        progressBar->setValue(progressBar->value() + 1);
    }

    //qDebug() << "results list completed. size of results list: " << resultObject.size() << '\n';
    //for (const auto& entry : resultObject)
    //{
    //    qDebug() << entry.first << ": " << entry.second.odds << "%\n";
    //}

    if (!found && paramObject.slotAmount == 4 && paramObject.lockedModAmount == 0)
        paramObject.itemName = itemNameSave;
    paramObject.blockSignals(false);
    populateResultsTable(resultObject, resultsWidget, paramObject, artifact_list);
    progressBar->hide();
}

void updateSpecialIcons(QWidget *specialIconWidget,QPushButton *specialBaseButton, QHBoxLayout *layout, const Parameters& paramObject)
{
    QString iconPath{":/Item Types/GUI Files/Item Types/"};

    while (layout->count() > 0)
    {
        QLayoutItem *item = layout->takeAt(0);
        delete item->widget();
        delete item;
    }
    for (const auto& tag : paramObject.specialBaseTypes)
    {
        QLabel *label = new QLabel(specialIconWidget);
        label->setPixmap(QPixmap(iconPath + QString::fromStdString(tag) + ".png"));
        label->setAlignment(Qt::AlignCenter);
        label->setAttribute(Qt::WA_TransparentForMouseEvents);
        layout->insertWidget(0,label);
    }
    if (layout->count() > 0)
        specialBaseButton->setText("");
    else
        specialBaseButton->setText("<subtypes>");

    layout->addStretch();
}

inline void exportOddsIt(const std::unordered_map<std::string, Enchant>& enchant_list, Parameters& paramObject, const std::unordered_map <std::string, Artifacts>& artifact_list, const std::map<std::string_view, int>& tagToIntMap,
                         const std::map<std::string_view, int>& artifactToIntMap, const std::map<std::string_view, int>& awakenToIntMap, const std::map<std::string_view, int>& uniqueToIntMap,
                         const std::multimap<std::string, std::string>& awakenedItemMap, const std::unordered_map<int, std::string>& reverseEnchantIDMap, std::unordered_map<std::string,bool>& modButtonInformer)
{
    paramObject.blockSignals(true);

    paramObject.slotAmount = 4;
    paramObject.threadAmount = std::thread::hardware_concurrency();

    double odds{};
    std::string concatenatedParams{};

    std::set<std::string> items{"WEAPON","ABILITY","ARMOR","RING"};
    std::set<std::string> alienItems{"ALIEN_WEAPON","ALIEN_ARMOR","ALIEN_RING"};
    std::set<std::string> neoItems{"NEO_WEAPON","NEO_ARMOR","NEO_RING"};
    std::set<std::string> summonItems{"SUMMONPOWERED_ABILITY","SUMMONPOWERED_ARMOR"};
    std::set<std::string> alienSummonItems{"ALIEN_SUMMONPOWERED_ARMOR","NEO_SUMMONPOWERED_ARMOR"};
    std::set<std::set<std::string>> itemSets{items,alienItems,neoItems,summonItems,alienSummonItems};

    int itemsCached{};
    int listSize = 0;
    for (const auto& itemSet : itemSets)
    {
        listSize += itemSet.size();
    }

    for (const auto& itemSet : itemSets)
    {
        // :::changing logic to only calculate alien artifacts for non-alien items:::
        //if (itemSet == items || itemSet == alienItems || itemSet == alienSummonItems)
        //    continue;

        for (const auto& item : itemSet)
        {
            //if (item == "ALIEN_SUMMONPOWERED_ARMOR")
            //    continue;
            std::string outputFileName{item + ".txt"};
            //std::string outputFileName{item + "_TECHNOLOGY.txt"};
            std::ofstream outFile(outputFileName, std::ios::app);
            std::unordered_map<std::string,Enchant> culledList{};

            paramObject.specialBaseTypes.clear();
            culledList.clear();

            if (itemSet == items)
                paramObject.itemType = item;
            else if (itemSet == alienSummonItems)
            {
                paramObject.itemType = "ARMOR";
                paramObject.specialBaseTypes.emplace("SUMMONPOWERED");
                if (item.contains("NEO"))
                    paramObject.specialBaseTypes.emplace("NEO_ALIEN");
                else
                    paramObject.specialBaseTypes.emplace("ALIEN");
            }
            else
            {
                if (item == "ALIEN_WEAPON" || item == "NEO_WEAPON")
                    paramObject.itemType = "WEAPON";
                if (item == "ALIEN_ARMOR" || item == "NEO_ARMOR" || item == "SUMMONPOWERED_ARMOR")
                    paramObject.itemType = "ARMOR";
                if (item == "ALIEN_RING" || item == "NEO_RING")
                    paramObject.itemType = "RING";
                if (item == "SUMMONPOWERED_ABILITY")
                    paramObject.itemType = "ABILITY";
            }

            if (itemSet == alienItems)
                paramObject.specialBaseTypes.emplace("ALIEN");
            if (itemSet == neoItems)
                paramObject.specialBaseTypes.emplace("NEO_ALIEN");
            if (itemSet == summonItems)
                paramObject.specialBaseTypes.emplace("SUMMONPOWERED");


            updateDesiredInformer(enchant_list,paramObject,modButtonInformer,awakenedItemMap);

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
                // :::: more alien artifact logic ::::
                //if (!enchant.first.contains("Alien") || enchant.first.contains("Neo"))
                //    continue;


                paramObject.desiredMod = enchant.first;
                for (const auto& artifact : artifact_list)
                {
                    // :::: and more alien artifact logic :::
                    //if (!artifact.first.contains("Technology"))
                    //    continue;


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
            outFile.close();

            itemsCached++;
            qDebug() << "Pools cached: " << itemsCached << " of " << listSize << "\n\n";
        }
    }
    qDebug() << "Done caching results for sets: ";
    for (const auto& set : itemSets)
        for (const auto& item : set)
            qDebug() << item << ", ";

    paramObject.blockSignals(false);
}

void exportAwakensIt(const std::unordered_map<std::string, Enchant>& enchant_list, Parameters& paramObject, const std::unordered_map <std::string, Artifacts>& artifact_list, const std::map<std::string_view, int>& tagToIntMap,
                     const std::map<std::string_view, int>& artifactToIntMap, const std::map<std::string_view, int>& awakenToIntMap, const std::map<std::string_view, int>& uniqueToIntMap,
                     const std::multimap<std::string, std::string>& awakenedItemMap, const std::unordered_map<int, std::string>& reverseEnchantIDMap, std::unordered_map<std::string, bool>& modButtonInformer)
{
    paramObject.blockSignals(true);

    paramObject.threadAmount = std::thread::hardware_concurrency();
    paramObject.slotAmount = 4;

    double odds{};
    std::string concatenatedParams{};

    std::string outputFileName{ "AWAKENS_SUMMONPOWERED.txt" };
    std::ofstream outFile(outputFileName, std::ios::app);
    std::unordered_map<std::string, Enchant> culledList{};

    int listSize = awakenedItemMap.size();
    int itemsCached{};
    for (const auto& item : awakenedItemMap)
    {

        paramObject.specialBaseTypes.clear();
        culledList.clear();

        if (item.first != "Robe of the Tlatoani" && item.first != "Tlatoani's Shroud" && item.first != "LoD Armors" && item.first != "AoO Armors")
            continue;
        else
            paramObject.specialBaseTypes.emplace("SUMMONPOWERED");

        paramObject.itemName = item.first;

        if (enchant_list.at(item.second).item_tags.contains("WEAPON"))
            paramObject.itemType = "WEAPON";
        else if (enchant_list.at(item.second).item_tags.contains("ABILITY"))
            paramObject.itemType = "ABILITY";
        else if (enchant_list.at(item.second).item_tags.contains("ARMOR"))
            paramObject.itemType = "ARMOR";
        else if (enchant_list.at(item.second).item_tags.contains("RING"))
            paramObject.itemType = "RING";

        if (enchant_list.at(item.second).tags.contains("ALIEN"))
        {
            if (enchant_list.at(item.second).tags.contains("NEO_ALIEN"))
                paramObject.specialBaseTypes.emplace("NEO_ALIEN");
            else
            {
                if (item.first.contains("Neo"))
                    paramObject.specialBaseTypes.emplace("NEO_ALIEN");
                else
                    paramObject.specialBaseTypes.emplace("ALIEN");
            }
        }

        updateDesiredInformer(enchant_list, paramObject, modButtonInformer, awakenedItemMap);

        for (const auto& mod : modButtonInformer)
        {
            if (mod.second == true)
                culledList.emplace(mod.first, enchant_list.at(mod.first));
        }

        paramObject.desiredMod = item.second;
        for (const auto& artifact : artifact_list)
        {
            paramObject.artifactSelection = artifact.first;
            odds = createTrees(enchant_list, artifact_list, paramObject, tagToIntMap, artifactToIntMap, awakenToIntMap, uniqueToIntMap, awakenedItemMap, reverseEnchantIDMap);
            concatenatedParams = concatenateParams(enchant_list, paramObject, tagToIntMap, artifactToIntMap, awakenToIntMap, awakenedItemMap);
            outFile << concatenatedParams << "," << odds << "\n";
        }
        outFile.flush();

        /*
        int resultsCached{};
        int size = culledList.size();
        std::cout << "Caching results for " << size << "enchants. :: " << item.first << " ::\n\n";
        for (const auto& enchant : culledList)
        {
            paramObject.desiredMod = enchant.first;
            for (const auto& artifact : artifact_list)
            {
                paramObject.artifactSelection = artifact.first;
                odds = createTrees(enchant_list, artifact_list, paramObject, tagToIntMap, artifactToIntMap, awakenToIntMap, uniqueToIntMap, awakenedItemMap, reverseEnchantIDMap);
                concatenatedParams = concatenateParams(enchant_list, paramObject, tagToIntMap, artifactToIntMap, awakenToIntMap, awakenedItemMap);
                outFile << concatenatedParams << "," << odds << "\n";
            }
            resultsCached++;
            outFile.flush();
            std::cout << resultsCached << " of " << size << '\n';
        }
        std::cout << "\nNumber of results cached: " << resultsCached << "\n\n";

        */

        itemsCached++;
        qDebug() << "Items cached: " << itemsCached << " of " << listSize << "\n\n";
    }

    paramObject.blockSignals(false);
    return;
}

void exportRobeMatrix(const std::unordered_map<std::string, Enchant>& enchant_list, Parameters& paramObject, const std::unordered_map <std::string, Artifacts>& artifact_list, const std::map<std::string_view, int>& tagToIntMap,
                     const std::map<std::string_view, int>& artifactToIntMap, const std::map<std::string_view, int>& awakenToIntMap, const std::map<std::string_view, int>& uniqueToIntMap,
                     const std::multimap<std::string, std::string>& awakenedItemMap, const std::unordered_map<int, std::string>& reverseEnchantIDMap, std::unordered_map<std::string, bool>& modButtonInformer)
{
    paramObject.blockSignals(true);

    paramObject.threadAmount = std::thread::hardware_concurrency();
    paramObject.slotAmount = 4;
    paramObject.itemType = "ARMOR";

    double odds{};
    std::string concatenatedParams{};

    std::string outputFileName{ "ROBE_MATRIX.txt" };
    std::ofstream outFile(outputFileName, std::ios::app);
    std::unordered_map<std::string, Enchant> culledList{};

    std::set<std::string> matrixes { "Matrix Armors","Neo Matrix Armors" };
    std::set<std::string> awakens { "Katalonian Matrix Enhancement","Foraxian Matrix Enhancement", "Untarian Matrix Enhancement","Malogian Matrix Enhancement" };
    for (const auto& matrix : matrixes)
    {
        paramObject.itemName = matrix;

        paramObject.specialBaseTypes.clear();
        paramObject.specialBaseTypes.emplace("SUMMONPOWERED");
        if (matrix.contains("Neo"))
            paramObject.specialBaseTypes.emplace("NEO_ALIEN");
        else
                paramObject.specialBaseTypes.emplace("ALIEN");

        updateDesiredInformer(enchant_list, paramObject, modButtonInformer, awakenedItemMap);

        for (const auto& mod : modButtonInformer)
        {
            if (mod.second == true)
                culledList.emplace(mod.first, enchant_list.at(mod.first));
        }
        for (const auto& awaken : awakens)
        {
            paramObject.desiredMod = awaken;
            for (const auto& artifact : artifact_list)
            {
                paramObject.artifactSelection = artifact.first;
                odds = createTrees(enchant_list, artifact_list, paramObject, tagToIntMap, artifactToIntMap, awakenToIntMap, uniqueToIntMap, awakenedItemMap, reverseEnchantIDMap);
                concatenatedParams = concatenateParams(enchant_list, paramObject, tagToIntMap, artifactToIntMap, awakenToIntMap, awakenedItemMap);
                outFile << concatenatedParams << "," << odds << "\n";
            }
            outFile.flush();
        }
    }

    qDebug() << "\nFinished exporting robe matrix odds.\n";
    paramObject.blockSignals(false);
}
bool MainWindow::eventFilter(QObject *watched, QEvent *event)
{

    if (event->type() == QEvent::MouseButtonPress)
    {
        QPoint clickPos = static_cast<QMouseEvent*>(event)->globalPosition().toPoint();
        QWidget *clickWidget = QApplication::widgetAt(clickPos);

        if (ui->specialBaseList->isVisible())
        {
            QRect listRect = QRect(ui->specialBaseList->mapToGlobal(QPoint(0,0)),ui->specialBaseList->size());

           // if (!listRect.contains(clickPos))
            //    ui->specialBaseList->hide();
            if (clickWidget != ui->specialBaseList && clickWidget != ui->specialBaseButton && !listRect.contains(clickPos))
            {
                ui->specialBaseList->hide();
            }
        }  
    }

    else if (event->type() == QEvent::MouseButtonRelease && watched != ui->specialBaseButton)
    {


        QPoint clickPos = static_cast<QMouseEvent*>(event)->globalPosition().toPoint();
        QWidget *clickWidget = QApplication::widgetAt(clickPos);

        if (clickWidget && clickWidget->parentWidget())
        {


            if (QComboBox *comboBox = qobject_cast<QComboBox*>(clickWidget->parentWidget()))
            {
                if (comboBox->isEditable() && comboBox->isEnabled())
                {
                    bool focusCheck = comboBox->property("wasFocused").toBool();
                    bool hasExecuted = comboBox->property("hasExecuted").toBool();

                    if (!hasExecuted)
                    {
                        if (focusCheck)
                        {
                            //qDebug() << "if statement \n";
                            //comboBox->completer()->popup()->hide();
                            comboBox->setProperty("wasFocused",false);
                        }
                        else
                        {
                            //qDebug() << "else statement\n";
                            comboBox->completer()->setCompletionPrefix("");
                            comboBox->completer()->complete();
                            comboBox->setProperty("wasFocused",true);
                        }
                        comboBox->setProperty("hasExecuted",true);
                    }
                    else
                    {
                        comboBox->setProperty("hasExecuted",false);
                    }
                }
            }
        }

    }
    if (event->type() == QEvent::WindowDeactivate)
    {
        if (ui->specialBaseList->isVisible())
        {
            ui->specialBaseList->hide();
        }
    }
    if (event->type() == QEvent::FocusOut)
    {
        QFocusEvent *focusEvent = static_cast<QFocusEvent*>(event);
        if (focusEvent->reason() == Qt::PopupFocusReason)
            return false;

        if (QComboBox *comboBox = qobject_cast<QComboBox*>(watched) )
        {
            if (comboBox->isEditable())
            {
                int index = comboBox->currentIndex();
                comboBox->setEditText(comboBox->itemText(index));
                comboBox->setProperty("wasFocused",false);
                qDebug() << "focusout event called.\n";
            }
        }
    }
    return QMainWindow::eventFilter(watched, event);
}

void sendAwakenUpdates(QComboBox *comboBox, QComboBox *itemTypeWidget,QListWidget *specialBaseList, const std::unordered_map<std::string,Enchant>& enchant_list, const std::multimap<std::string,std::string>& awakenedItemMap, Parameters& paramObject)
{

    auto range = (awakenedItemMap.equal_range((comboBox->currentText().toStdString())));
    auto mod = range.first->second;
    qDebug() << mod << '\n';
    std::string itemType = *enchant_list.at(mod).item_tags.begin();
    auto specialBaseTypes = enchant_list.at(mod).specialBaseRequirement;
    auto& ench = enchant_list.at(mod);

    //paramObject.itemType = itemType;
    paramObject.specialBaseTypes.clear();
    for (int i=0;i < specialBaseList->count();++i)
    {
        QListWidgetItem* item = specialBaseList->item(i);

        item->setCheckState(Qt::Unchecked);
    }
    if (comboBox->currentIndex() != -1)
    {
        itemTypeWidget->setCurrentIndex(itemTypeWidget->findText(QString::fromStdString(itemType)));

        if (ench.tags.contains("ALIEN"))
        {
            if (comboBox->currentText().contains("Neo"))
                specialBaseList->findItems("NEO_ALIEN",Qt::MatchExactly).first()->setCheckState(Qt::Checked);
            else
                specialBaseList->findItems("ALIEN",Qt::MatchExactly).first()->setCheckState(Qt::Checked);
        }
    }
}

void checkAwakenItemType(QComboBox *awakenWidget, const std::unordered_map<std::string,Enchant>& enchant_list, const std::multimap<std::string,std::string>& awakenedItemMap, Parameters& paramObject)
{
    if (awakenedItemMap.contains(awakenWidget->currentText().toStdString()))
    {
        auto awaken = awakenedItemMap.equal_range((awakenWidget->currentText().toStdString())).first->second;
        auto type = *enchant_list.at(awaken).item_tags.begin();
        if (paramObject.itemType != type)
            awakenWidget->setCurrentIndex(-1);
    }
    else
        awakenWidget->setCurrentIndex(-1);
}

void updateSpecialBaseWidget(QListWidget *specialBaseList, Parameters& paramObject)
{
    for (int i{}; i < specialBaseList->count(); i++)
        specialBaseList->item(i)->setFlags(specialBaseList->item(i)->flags() | Qt::ItemIsEnabled | Qt::ItemIsUserCheckable);

    if (paramObject.itemType != "ABILITY" && paramObject.itemType != "ARMOR")
    {
        auto item = specialBaseList->findItems("SUMMONPOWERED",Qt::MatchExactly).first();
        item->setFlags(item->flags() & ~Qt::ItemIsEnabled & ~Qt::ItemIsUserCheckable);
        item->setCheckState(Qt::Unchecked);
    }
    if (paramObject.itemType == "ABILITY")
    {
        auto item = specialBaseList->findItems("ALIEN",Qt::MatchExactly).first();
        item->setFlags(item->flags() & ~Qt::ItemIsEnabled & ~Qt::ItemIsUserCheckable);
        item->setCheckState(Qt::Unchecked);
        item = specialBaseList->findItems("NEO_ALIEN",Qt::MatchExactly).first();
        item->setFlags(item->flags() & ~Qt::ItemIsEnabled & ~Qt::ItemIsUserCheckable);
        item->setCheckState(Qt::Unchecked);
    }
}

void updateClearButtons(MainWindow *mainWindow)
{
    auto *here = mainWindow->ui;
    QList<QPair<QComboBox*,QPushButton*>> widgetToButtonList { {here->locked1Widget,here->clear1Widget}, {here->locked2Widget,here->clear2Widget}, {here->locked3Widget,here->clear3Widget}, {here->awakenedItemWidget,here->clearAwakenWidget}, {here->desiredModWidget,here->clearDesiredWidget}  };

    for (auto& pair : widgetToButtonList)
    {
        if (pair.first->currentIndex() == -1)
            pair.second->hide();
    }
    //QPair<QComboBox,QPushButton> widgetToButton{here->locked1Widget,here->clear1Widget};
}

void clearAwakenChoices(MainWindow *mainWindow, const std::unordered_map<std::string,Enchant>& enchant_list, const std::multimap<std::string,std::string>& awakenedItemMap)
{
    qDebug() << "clearAwakenChoices called.\n";
    auto *here = mainWindow->ui;
    QList<QPair<QComboBox*,QPushButton*>> widgets { {here->locked1Widget,here->clear1Widget}, {here->locked2Widget,here->clear2Widget}, {here->locked3Widget,here->clear3Widget}, {here->desiredModWidget,here->clearDesiredWidget}  };

    std::unordered_set<std::string> validAwakens;
    auto range = awakenedItemMap.equal_range(here->awakenedItemWidget->currentText().toStdString());


    for (auto it = range.first; it != range.second; it++ )
    {
        validAwakens.emplace(it->second);
    }

    for (auto& widget : widgets)
    {
        bool isAwaken{false};
        if (enchant_list.contains(widget.first->currentText().toStdString()))
        {
            if (enchant_list.at(widget.first->currentText().toStdString()).tags.contains("AWAKENED"))
                isAwaken = true;
        }

        qDebug() << widget << " text: " << widget.first->currentText() << "current index: " << widget.first->currentIndex() << '\n';
        if (isAwaken)
        {
            if (!validAwakens.contains(widget.first->currentText().toStdString()))
            {
                //widget.first->setCurrentIndex(-1);
                widget.second->click();
                //paramObject.setDesired("");
                qDebug() << "passed if check. \n";
            }
        }
        else if (widget.first->currentText().isEmpty())
        {
            qDebug() << "passed empty check.\n";
            //widget.first->setCurrentIndex(-1);
            widget.second->click();
            //paramObject.setDesired("");
        }
    }

}

MainWindow::MainWindow(const std::unordered_map<std::string, Enchant>& enchant_list,
                       const std::unordered_map<std::string, Artifacts>& artifact_list,
                       const std::multimap<std::string, std::string>& awakenedItemMap,
                       const std::map<std::string_view, int>& tagToIntMap,
                       const std::map<std::string_view, int>& artifactToIntMap,
                       const std::map<std::string_view, int>& awakenToIntMap,
                       const std::map<std::string_view, int>& uniqueToIntMap,
                       const std::unordered_map<std::string, double>& oddsCache,
                       const std::unordered_map<int,std::string>& reverseEnchantIDMap,
                       const std::unordered_map<std::string,std::string>& enchantToIconMap,
                       QWidget *parent)
    : QMainWindow(parent)
    , ui(new Ui::MainWindow)
{
    paramObject.threadAmount = std::thread::hardware_concurrency();
    //std::unordered_map<std::string,std::string> enchantToIconMap{};
    //enchantToIconMap = buildEnchantToIconMap(enchant_list);
    for (const auto& entry : enchantToIconMap)
        qDebug() << entry.first << "  ::  " << entry.second << '\n';

    ui->setupUi(this);
    qApp->installEventFilter(this);
    ui->centralwidget->setFocusPolicy(Qt::ClickFocus);
    this->setWindowTitle("RotMG Enchant Calculator");


    static QHash<QString,QIcon> iconCache;
    static QHash<QString,QIcon> iconPixmapCache;
    for (const auto& mod : enchant_list)
    {
        QString iconPath{":/Enchantment Icons/GUI Files/Enchantment Icons/" + QString::fromStdString(enchantToIconMap.at(mod.first)) + ".png"};
        iconCache.emplace(iconPath,QIcon(iconPath));
        QPixmap pixmap = iconCache.value(iconPath).pixmap(QSize(54,54),QIcon::Disabled);
        iconPixmapCache.emplace(iconPath,QIcon(pixmap));
    }

    //debug
    QObject::connect(&paramObject, &Parameters::baseChanged, this, [](){qDebug() << "::::::::::::::::::::base changed once::::::::::::\n";},Qt::QueuedConnection);
    //set up desired mod widget to be searchable
    ui->desiredModWidget->setEditable(true);
    ui->desiredModWidget->lineEdit()->setPlaceholderText("<target...>");
    ui->desiredModWidget->setInsertPolicy(QComboBox::NoInsert);

    //icons
    ui->specialIconWidget->setAttribute(Qt::WA_TransparentForMouseEvents);  
    QHBoxLayout *layout = new QHBoxLayout(ui->specialIconWidget);
    layout->setContentsMargins(15,0,15,0);
    layout->setSpacing(15);
    layout->addStretch();
    QObject::connect(&paramObject,&Parameters::specialBaseTypesChanged, this, [this, layout](){updateSpecialIcons(ui->specialIconWidget,ui->specialBaseButton,layout,paramObject);});

    //CalculateButton validity check setup
    QObject::connect(&paramObject, &Parameters::baseChanged, this, [this](){checkCalculationValidity(ui->CalculateButton,paramObject);});
    QObject::connect(&paramObject, &Parameters::slotsChanged, this, [this](){checkCalculationValidity(ui->CalculateButton,paramObject);});
    QObject::connect(&paramObject, &Parameters::desiredChanged, this, [this](){checkCalculationValidity(ui->CalculateButton,paramObject);});
    QObject::connect(&paramObject, &Parameters::dustChanged, this, [this](){checkCalculationValidity(ui->CalculateButton,paramObject);});

    //lockedModWidgets validity check setup
    QObject::connect(&paramObject, &Parameters::slotsChanged, this, [this](){checkSlotValidity(ui->locked1Widget,ui->locked2Widget,ui->locked3Widget,ui->clear1Widget,ui->clear2Widget,ui->clear3Widget,paramObject);});
    ui->clear1Widget->hide();
    ui->clear2Widget->hide();
    ui->clear3Widget->hide();

    ui->locked1Widget->setEditable(true);
    ui->locked1Widget->lineEdit()->setPlaceholderText("~~");
    ui->locked2Widget->setEditable(true);
    ui->locked2Widget->lineEdit()->setPlaceholderText("~~");
    ui->locked3Widget->setEditable(true);
    ui->locked3Widget->lineEdit()->setPlaceholderText("~~");

    //make specialBaseList act similar to a QComboBox
    ui->specialBaseList->hide();
    ui->specialBaseList->setResizeMode(QListView::Adjust);
    ui->specialBaseList->setFocusPolicy(Qt::NoFocus);
    for (int i=0;i < ui->specialBaseList->count();++i)
    {
        QListWidgetItem* item = ui->specialBaseList->item(i);
        item->setSizeHint(QSize(ui->specialBaseList->width(),50));
    }
    QObject::connect(ui->specialBaseButton, &QPushButton::clicked, this, [this](){ui->specialBaseList->setVisible(!ui->specialBaseList->isVisible());});
    QObject::connect(ui->specialBaseList, &QListWidget::itemClicked, this, [this](QListWidgetItem *item)
                    {
                        if (item->flags() & Qt::ItemIsEnabled)
                            item->setCheckState(item->checkState() == Qt::Checked ? Qt::Unchecked : Qt::Checked);

                        if (item->text() == "ALIEN" && item->checkState() == Qt::Checked)
                            ui->specialBaseList->findItems("NEO_ALIEN",Qt::MatchExactly).first()->setCheckState(Qt::Unchecked);
                        else if (item->text() == "NEO_ALIEN" && item->checkState() == Qt::Checked)
                            ui->specialBaseList->findItems("ALIEN",Qt::MatchExactly).first()->setCheckState(Qt::Unchecked);
                    });
    //
    ui->progressBar->setMaximum(artifact_list.size());
    ui->progressBar->hide();
    QObject::connect(ui->CalculateButton,&QPushButton::pressed,this,[this](){ui->progressBar->show();ui->progressBar->setValue(0);});



    ui->resultsWidget->setColumnWidth(0,220);
    //ui->resultsWidget->setColumnWidth(4,150);
    ui->resultsWidget->setFrameStyle(QFrame::NoFrame);
    ui->resultsWidget->viewport()->setAutoFillBackground(false);
    ui->resultsWidget->horizontalHeader()->setStretchLastSection(true);
    ui->resultsWidget->setIconSize(QSize(40,40));
    ui->resultsWidget->horizontalHeader()->setFixedHeight(40);
    ui->resultsWidget->setStyleSheet("QTableWidget{background-color: rgb(40,40,40);border: 1px solid rgb(30,30,30);border-radius: 4px;}"
                                     "QWidget#tableViewport{border-bottom-left-radius: 4px ;border-bottom-right-radius: 4px ;border-top-left-radius: 4px;border-top-right-radius: 4px;}"
                                     "QHeaderView::section:horizontal:first {border-top-left-radius: 4px;}"
                                     "QHeaderView::section:horizontal:last {border-top-right-radius: 4px;}"
                                     "QTableWidget QScrollBar:vertical {border-radius: 2px; border: 1px solid transparent;background: transparent; width: 10px; margin: 0px 0px 0px 4px; padding-top:0px; padding-bottom:0px;}"
                                     "QTableWidget QScrollBar::handle:vertical {background-color: rgb(60,60,60); border: 1px solid rgb(60,60,60); min-height: 20px;border-radius: 2px; margin: 0px;}"
                                     "QTableWidget QScrollBar::add-page:vertical,QTableWidget QScrollBar::sub-page:vertical {background: none;border: none;}"
                                     "QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {border: none;background: none;height: 0px;width: 0px;subcontrol-position: none;subcontrol-origin: none;}");
    for (const auto& mod : enchant_list)
    {
        modButtonInformer.emplace(mod.first, true);
        desiredInformer.emplace(mod.first,true);
    }
    qRegisterMetaType<Parameters>();

    //connects initializing widgets to paramObject
    QObject::connect(ui->rarityWidget, &QComboBox::currentIndexChanged, &paramObject, &Parameters::setSlots);
    QObject::connect(ui->itemTypeWidget, &QComboBox::currentTextChanged, &paramObject, &Parameters::setType);
    QObject::connect(ui->dustTypeWidget, &QComboBox::currentTextChanged, &paramObject, &Parameters::setDustType);
    QObject::connect(ui->awakenedItemWidget, &QComboBox::currentIndexChanged, this, [this](){paramObject.setName(ui->awakenedItemWidget->currentText());});
    QObject::connect(ui->awakenedItemWidget, &QComboBox::currentIndexChanged, this, [this](){ui->awakenedItemWidget->clearFocus();},Qt::QueuedConnection);

    QObject::connect(ui->awakenedItemWidget, &QComboBox::currentIndexChanged, this, [this, &enchant_list, &awakenedItemMap](){clearAwakenChoices(this, enchant_list, awakenedItemMap);},Qt::QueuedConnection);

    //QObject::connect(ui->awakenedItemWidget->lineEdit(), &QLineEdit::selectionChanged,
    //                 this, [this]() {
    //                     if (ui->awakenedItemWidget->currentIndex() == -1) {
    //                         ui->awakenedItemWidget->showPopup();
    //                     }
    //                 }, Qt::QueuedConnection);
    QObject::connect(ui->desiredModWidget, &QComboBox::currentIndexChanged, this, [this](){paramObject.setDesired(ui->desiredModWidget->currentText());});
    QObject::connect(ui->desiredModWidget, &QComboBox::currentIndexChanged, this, [this](){ui->desiredModWidget->lineEdit()->clearFocus();},Qt::QueuedConnection);
    QObject::connect(ui->locked1Widget, &QComboBox::currentIndexChanged, this, [this](){updateLockedMods(*ui->locked1Widget,*ui->locked2Widget,*ui->locked3Widget,paramObject);});
    QObject::connect(ui->locked1Widget, &QComboBox::currentIndexChanged, this, [this](){ui->locked1Widget->lineEdit()->clearFocus();},Qt::QueuedConnection);
    QObject::connect(ui->locked2Widget, &QComboBox::currentIndexChanged, this, [this](){updateLockedMods(*ui->locked1Widget,*ui->locked2Widget,*ui->locked3Widget,paramObject);});
    QObject::connect(ui->locked2Widget, &QComboBox::currentIndexChanged, this, [this](){ui->locked2Widget->lineEdit()->clearFocus();},Qt::QueuedConnection);
    QObject::connect(ui->locked3Widget, &QComboBox::currentIndexChanged, this, [this](){updateLockedMods(*ui->locked1Widget,*ui->locked2Widget,*ui->locked3Widget,paramObject);});
    QObject::connect(ui->locked3Widget, &QComboBox::currentIndexChanged, this, [this](){ui->locked3Widget->lineEdit()->clearFocus();},Qt::QueuedConnection);
    QObject::connect(ui->tierWidget, &QTableWidget::itemChanged, [](QTableWidgetItem *item){paramObject.setTiers(item->text(),item->checkState());});
    QObject::connect(ui->specialBaseList,&QListWidget::itemChanged, [](QListWidgetItem *item){paramObject.setSpecialBaseTypes(item->text(),item->checkState());});

    //connects Calculate button to buildResultsList
    ui->tierWidget->setEnabled(false);
    QObject::connect(ui->CalculateButton, &QPushButton::pressed, this, [this, &enchant_list, &artifact_list, &awakenedItemMap, &tagToIntMap,
                                                                        &artifactToIntMap, &awakenToIntMap, &uniqueToIntMap, &oddsCache, &reverseEnchantIDMap](){buildResultsList(enchant_list,artifact_list,
                                                                       paramObject,tagToIntMap,artifactToIntMap,awakenToIntMap,uniqueToIntMap,awakenedItemMap,resultObject,oddsCache,*ui->resultsWidget,reverseEnchantIDMap,ui->progressBar);}  );
    //toggle tierWidget enabled/disabled
    QObject::connect(&paramObject,&Parameters::desiredChanged, this, [this, &enchant_list](){if (!paramObject.desiredMod.empty()) enchant_list.at(paramObject.desiredMod).tags.contains("TIERED") ? ui->tierWidget->setEnabled(true) : ui->tierWidget->setEnabled(false); });

    //show popup when text field becomes empty
    /*
    QObject::connect(ui->awakenedItemWidget->lineEdit(),&QLineEdit::textEdited, this, [this]()
                    {
                    if (ui->awakenedItemWidget->lineEdit()->text().isEmpty())
                    {
                        //ui->awakenedItemWidget->completer()->setCompletionMode(QCompleter::UnfilteredPopupCompletion);
                        //ui->awakenedItemWidget->completer()->setFilterMode(Qt::MatchStartsWith);
                        ui->awakenedItemWidget->completer()->setCompletionPrefix("");
                        ui->awakenedItemWidget->completer()->complete();
                    }
                    else
                    {
                        //->awakenedItemWidget->completer()->setCompletionMode(QCompleter::PopupCompletion);
                        //ui->awakenedItemWidget->completer()->setFilterMode(Qt::MatchContains);
                    }
                    },Qt::QueuedConnection);
    */
    //connecting itemType selection to awakened item list
    QObject::connect(&paramObject, &Parameters::nameChanged, this, [this, &enchant_list, &awakenedItemMap](){sendAwakenUpdates(ui->awakenedItemWidget,ui->itemTypeWidget,ui->specialBaseList,enchant_list,awakenedItemMap,paramObject);});
    QObject::connect(&paramObject, &Parameters::baseChanged, this, [this, &enchant_list, &awakenedItemMap](){checkAwakenItemType(ui->awakenedItemWidget,enchant_list,awakenedItemMap,paramObject);});

    //connecting modButtonInformer to signals about changes to base and name parameters
    QObject::connect(&paramObject, &Parameters::baseChanged, this, [this, &enchant_list, &enchantToIconMap, &awakenedItemMap](){updateDesiredList(*ui->desiredModWidget,modButtonInformer,desiredInformer,enchant_list,paramObject,enchantToIconMap,awakenedItemMap, iconCache, iconPixmapCache);});
    QObject::connect(&paramObject, &Parameters::nameChanged, this, [this, &enchant_list, &enchantToIconMap, &awakenedItemMap](){updateDesiredList(*ui->desiredModWidget,modButtonInformer,desiredInformer,enchant_list,paramObject,enchantToIconMap,awakenedItemMap, iconCache, iconPixmapCache);});

    QObject::connect(&paramObject, &Parameters::baseChanged, this, [this, &enchant_list, &enchantToIconMap, &awakenedItemMap](){updateButtonList(*ui->locked1Widget,*ui->locked2Widget,*ui->locked3Widget,modButtonInformer,enchant_list,paramObject,enchantToIconMap,awakenedItemMap, iconCache);});
    QObject::connect(&paramObject, &Parameters::nameChanged, this, [this, &enchant_list, &enchantToIconMap, &awakenedItemMap](){updateButtonList(*ui->locked1Widget,*ui->locked2Widget,*ui->locked3Widget,modButtonInformer,enchant_list,paramObject,enchantToIconMap,awakenedItemMap, iconCache);});

    QObject::connect(&paramObject, &Parameters::baseChanged, this, [this, &enchant_list, &enchantToIconMap, &awakenedItemMap](){updateButtonList(*ui->locked2Widget,*ui->locked1Widget,*ui->locked3Widget,modButtonInformer,enchant_list,paramObject,enchantToIconMap,awakenedItemMap, iconCache);});
    QObject::connect(&paramObject, &Parameters::nameChanged, this, [this, &enchant_list, &enchantToIconMap, &awakenedItemMap](){updateButtonList(*ui->locked2Widget,*ui->locked1Widget,*ui->locked3Widget,modButtonInformer,enchant_list,paramObject,enchantToIconMap,awakenedItemMap, iconCache);});

    QObject::connect(&paramObject, &Parameters::baseChanged, this, [this, &enchant_list, &enchantToIconMap, &awakenedItemMap](){updateButtonList(*ui->locked3Widget,*ui->locked2Widget,*ui->locked1Widget,modButtonInformer,enchant_list,paramObject,enchantToIconMap,awakenedItemMap, iconCache);});
    QObject::connect(&paramObject, &Parameters::nameChanged, this, [this, &enchant_list, &enchantToIconMap, &awakenedItemMap](){updateButtonList(*ui->locked3Widget,*ui->locked2Widget,*ui->locked1Widget,modButtonInformer,enchant_list,paramObject,enchantToIconMap,awakenedItemMap, iconCache);});

    //make lineEdit of comboBoxes get reset to the text of its current index if text is left changed when losing focus
    QObject::connect(ui->awakenedItemWidget->lineEdit(),&QLineEdit::editingFinished, this, [this](){qDebug() << "editing finished\n"; ui->awakenedItemWidget->setCurrentIndex(ui->awakenedItemWidget->currentIndex());});

    //connecting desired widget and locked widgets together
    QObject::connect(ui->desiredModWidget, &QComboBox::currentIndexChanged, this, [this, &enchant_list, &enchantToIconMap, &awakenedItemMap](){updateDesiredList(*ui->desiredModWidget,modButtonInformer,desiredInformer,enchant_list,paramObject,enchantToIconMap,awakenedItemMap, iconCache, iconPixmapCache);});
    QObject::connect(ui->desiredModWidget, &QComboBox::currentIndexChanged, this, [this, &enchant_list, &enchantToIconMap, &awakenedItemMap](){updateButtonList(*ui->locked1Widget,*ui->locked2Widget,*ui->locked3Widget,modButtonInformer,enchant_list,paramObject,enchantToIconMap,awakenedItemMap, iconCache);});
    QObject::connect(ui->desiredModWidget, &QComboBox::currentIndexChanged, this, [this, &enchant_list, &enchantToIconMap, &awakenedItemMap](){updateButtonList(*ui->locked2Widget,*ui->locked1Widget,*ui->locked3Widget,modButtonInformer,enchant_list,paramObject,enchantToIconMap,awakenedItemMap, iconCache);});
    QObject::connect(ui->desiredModWidget, &QComboBox::currentIndexChanged, this, [this, &enchant_list, &enchantToIconMap, &awakenedItemMap](){updateButtonList(*ui->locked3Widget,*ui->locked2Widget,*ui->locked1Widget,modButtonInformer,enchant_list,paramObject,enchantToIconMap,awakenedItemMap, iconCache);});

    QObject::connect(ui->locked1Widget, &QComboBox::currentIndexChanged, this, [this, &enchant_list, &enchantToIconMap, &awakenedItemMap](){updateDesiredList(*ui->desiredModWidget,modButtonInformer,desiredInformer,enchant_list,paramObject,enchantToIconMap,awakenedItemMap, iconCache, iconPixmapCache);});
    QObject::connect(ui->locked1Widget, &QComboBox::currentIndexChanged, this, [this, &enchant_list, &enchantToIconMap, &awakenedItemMap](){updateButtonList(*ui->locked1Widget,*ui->locked2Widget,*ui->locked3Widget,modButtonInformer,enchant_list,paramObject,enchantToIconMap,awakenedItemMap, iconCache);});
    QObject::connect(ui->locked1Widget, &QComboBox::currentIndexChanged, this, [this, &enchant_list, &enchantToIconMap, &awakenedItemMap](){updateButtonList(*ui->locked2Widget,*ui->locked1Widget,*ui->locked3Widget,modButtonInformer,enchant_list,paramObject,enchantToIconMap,awakenedItemMap, iconCache);});
    QObject::connect(ui->locked1Widget, &QComboBox::currentIndexChanged, this, [this, &enchant_list, &enchantToIconMap, &awakenedItemMap](){updateButtonList(*ui->locked3Widget,*ui->locked2Widget,*ui->locked1Widget,modButtonInformer,enchant_list,paramObject,enchantToIconMap,awakenedItemMap, iconCache);});

    QObject::connect(ui->locked2Widget, &QComboBox::currentIndexChanged, this, [this, &enchant_list, &enchantToIconMap, &awakenedItemMap](){updateDesiredList(*ui->desiredModWidget,modButtonInformer,desiredInformer,enchant_list,paramObject,enchantToIconMap,awakenedItemMap, iconCache, iconPixmapCache);});
    QObject::connect(ui->locked2Widget, &QComboBox::currentIndexChanged, this, [this, &enchant_list, &enchantToIconMap, &awakenedItemMap](){updateButtonList(*ui->locked1Widget,*ui->locked2Widget,*ui->locked3Widget,modButtonInformer,enchant_list,paramObject,enchantToIconMap,awakenedItemMap, iconCache);});
    QObject::connect(ui->locked2Widget, &QComboBox::currentIndexChanged, this, [this, &enchant_list, &enchantToIconMap, &awakenedItemMap](){updateButtonList(*ui->locked2Widget,*ui->locked1Widget,*ui->locked3Widget,modButtonInformer,enchant_list,paramObject,enchantToIconMap,awakenedItemMap, iconCache);});
    QObject::connect(ui->locked2Widget, &QComboBox::currentIndexChanged, this, [this, &enchant_list, &enchantToIconMap, &awakenedItemMap](){updateButtonList(*ui->locked3Widget,*ui->locked2Widget,*ui->locked1Widget,modButtonInformer,enchant_list,paramObject,enchantToIconMap,awakenedItemMap, iconCache);});

    QObject::connect(ui->locked3Widget, &QComboBox::currentIndexChanged, this, [this, &enchant_list, &enchantToIconMap, &awakenedItemMap](){updateDesiredList(*ui->desiredModWidget,modButtonInformer,desiredInformer,enchant_list,paramObject,enchantToIconMap,awakenedItemMap, iconCache, iconPixmapCache);});
    QObject::connect(ui->locked3Widget, &QComboBox::currentIndexChanged, this, [this, &enchant_list, &enchantToIconMap, &awakenedItemMap](){updateButtonList(*ui->locked1Widget,*ui->locked2Widget,*ui->locked3Widget,modButtonInformer,enchant_list,paramObject,enchantToIconMap,awakenedItemMap, iconCache);});
    QObject::connect(ui->locked3Widget, &QComboBox::currentIndexChanged, this, [this, &enchant_list, &enchantToIconMap, &awakenedItemMap](){updateButtonList(*ui->locked2Widget,*ui->locked1Widget,*ui->locked3Widget,modButtonInformer,enchant_list,paramObject,enchantToIconMap,awakenedItemMap, iconCache);});
    QObject::connect(ui->locked3Widget, &QComboBox::currentIndexChanged, this, [this, &enchant_list, &enchantToIconMap, &awakenedItemMap](){updateButtonList(*ui->locked3Widget,*ui->locked2Widget,*ui->locked1Widget,modButtonInformer,enchant_list,paramObject,enchantToIconMap,awakenedItemMap, iconCache);});

    //connect specialBase selection to mod widget updaters
    QObject::connect(&paramObject, &Parameters::specialBaseTypesChanged, this, [this, &enchant_list, &enchantToIconMap, &awakenedItemMap](){updateDesiredList(*ui->desiredModWidget,modButtonInformer,desiredInformer,enchant_list,paramObject,enchantToIconMap,awakenedItemMap, iconCache, iconPixmapCache);});
    QObject::connect(&paramObject, &Parameters::specialBaseTypesChanged, this, [this, &enchant_list, &enchantToIconMap, &awakenedItemMap](){updateButtonList(*ui->locked1Widget,*ui->locked2Widget,*ui->locked3Widget,modButtonInformer,enchant_list,paramObject,enchantToIconMap,awakenedItemMap, iconCache);});
    QObject::connect(&paramObject, &Parameters::specialBaseTypesChanged, this, [this, &enchant_list, &enchantToIconMap, &awakenedItemMap](){updateButtonList(*ui->locked2Widget,*ui->locked1Widget,*ui->locked3Widget,modButtonInformer,enchant_list,paramObject,enchantToIconMap,awakenedItemMap, iconCache);});
    QObject::connect(&paramObject, &Parameters::specialBaseTypesChanged, this, [this, &enchant_list, &enchantToIconMap, &awakenedItemMap](){updateButtonList(*ui->locked3Widget,*ui->locked2Widget,*ui->locked1Widget,modButtonInformer,enchant_list,paramObject,enchantToIconMap,awakenedItemMap, iconCache);});

    //connect itemType to specialBaseList
    QObject::connect(&paramObject, &Parameters::baseChanged, this, [this](){updateSpecialBaseWidget(ui->specialBaseList,paramObject);});

    //connects clear(X) buttons for locked mod selection
    QObject::connect(&paramObject,&Parameters::baseChanged, this, [this](){updateClearButtons(this);},Qt::QueuedConnection);
    QObject::connect(&paramObject,&Parameters::nameChanged, this, [this](){updateClearButtons(this);},Qt::QueuedConnection);

    QObject::connect(ui->clear1Widget, &QPushButton::pressed, this, [this](){ ui->locked1Widget->setCurrentIndex(-1);});
    QObject::connect(ui->locked1Widget,&QComboBox::currentIndexChanged, this, [this](){ui->locked1Widget->currentIndex() == -1 ? ui->clear1Widget->hide() : ui->clear1Widget->show() ;});
    QObject::connect(ui->clear2Widget, &QPushButton::pressed, this, [this](){ ui->locked2Widget->setCurrentIndex(-1);});
    QObject::connect(ui->locked2Widget,&QComboBox::currentIndexChanged, this, [this](){ui->locked2Widget->currentIndex() == -1 ? ui->clear2Widget->hide() : ui->clear2Widget->show() ;});
    QObject::connect(ui->clear3Widget, &QPushButton::pressed, this, [this](){ ui->locked3Widget->setCurrentIndex(-1);});
    QObject::connect(ui->locked3Widget,&QComboBox::currentIndexChanged, this, [this](){ui->locked3Widget->currentIndex() == -1 ? ui->clear3Widget->hide() : ui->clear3Widget->show() ;});

    ui->clearDesiredWidget->hide();
    QObject::connect(ui->clearDesiredWidget, &QPushButton::pressed, this, [this](){ ui->desiredModWidget->setCurrentIndex(-1);});
    QObject::connect(ui->desiredModWidget,&QComboBox::currentIndexChanged, this, [this](){ui->desiredModWidget->currentIndex() == -1 ? ui->clearDesiredWidget->hide() : ui->clearDesiredWidget->show() ;});

    ui->clearAwakenWidget->hide();
    QObject::connect(ui->clearAwakenWidget, &QPushButton::pressed, this, [this](){ ui->awakenedItemWidget->setCurrentIndex(-1);});
    QObject::connect(ui->awakenedItemWidget,&QComboBox::currentIndexChanged, this, [this](){ui->awakenedItemWidget->currentIndex() == -1 ? ui->clearAwakenWidget->hide() : ui->clearAwakenWidget->show() ;});
    //Make tier widget's texts toggle their cell when clicked
    QObject::connect(ui->tierWidget, &QTableWidget::itemClicked, this, [](QTableWidgetItem *item){item->setCheckState(item->checkState() == Qt::Checked ? Qt::Unchecked : Qt::Checked);});

    //setup cache-building button

    //exportOddsIt
    //QObject::connect(ui->cacheButton, &QPushButton::clicked, this, [this, &enchant_list, &artifact_list, &tagToIntMap, &artifactToIntMap, &awakenToIntMap, &uniqueToIntMap, &awakenedItemMap, &reverseEnchantIDMap](){exportOddsIt(enchant_list,paramObject,artifact_list,tagToIntMap,artifactToIntMap,awakenToIntMap,uniqueToIntMap,awakenedItemMap,reverseEnchantIDMap,modButtonInformer);});
    //exportAwakensIt
    QObject::connect(ui->cacheButton, &QPushButton::clicked, this, [this, &enchant_list, &artifact_list, &tagToIntMap, &artifactToIntMap, &awakenToIntMap, &uniqueToIntMap, &awakenedItemMap, &reverseEnchantIDMap](){exportAwakensIt(enchant_list,paramObject,artifact_list,tagToIntMap,artifactToIntMap,awakenToIntMap,uniqueToIntMap,awakenedItemMap,reverseEnchantIDMap,modButtonInformer);});
    //QObject::connect(ui->cacheButton, &QPushButton::clicked, this, [this, &enchant_list, &artifact_list, &tagToIntMap, &artifactToIntMap, &awakenToIntMap, &uniqueToIntMap, &awakenedItemMap, &reverseEnchantIDMap](){exportRobeMatrix(enchant_list,paramObject,artifact_list,tagToIntMap,artifactToIntMap,awakenToIntMap,uniqueToIntMap,awakenedItemMap,reverseEnchantIDMap,modButtonInformer);});

    //ui->cacheButton->hide();
    //ui->cacheButton->setEnabled(false);


    std::string previousItem{};
    for (const auto& pair : awakenedItemMap)
    {
        if (pair.first != previousItem)
        {
            QString awkIconPath{":/Awakenable Items/GUI Files/Awakenable Items/" + QString::fromStdString(pair.first) + ".png"};
            QIcon awkIcon(awkIconPath);
            ui->awakenedItemWidget->addItem(awkIcon,QString::fromStdString(pair.first));
        }
        previousItem = pair.first;
    }
    ui->awakenedItemWidget->setEditable(true);
    ui->awakenedItemWidget->lineEdit()->setPlaceholderText("<awakens>");
    ui->awakenedItemWidget->setInsertPolicy(QComboBox::NoInsert);
    ui->awakenedItemWidget->completer()->setFilterMode(Qt::MatchContains);
    ui->awakenedItemWidget->completer()->setCaseSensitivity(Qt::CaseInsensitive);
    ui->awakenedItemWidget->completer()->setCompletionMode(QCompleter::PopupCompletion);
    ui->awakenedItemWidget->completer()->setMaxVisibleItems(15);
    ui->awakenedItemWidget->completer()->popup()->setIconSize(QSize(40,40));
    ui->awakenedItemWidget->completer()->popup()->setStyleSheet("QAbstractItemView {background-color: #212121;} QAbstractItemView::item {max-height: 44px; }");
    //ui->awakenedItemWidget->lineEdit()->setFocusPolicy(Qt::NoFocus);
    //updateCompleter(*ui->awakenedItemWidget);







}

MainWindow::~MainWindow()
{
    delete ui;
}
