//#include "Classes+Functions.h"
#include "mainwindow.h"

int main(int argc, char *argv[])
{
    QApplication a(argc, argv);

    QTranslator translator;
    const QStringList uiLanguages = QLocale::system().uiLanguages();
    for (const QString &locale : uiLanguages) {
        const QString baseName = "EnchantCalculator_" + QLocale(locale).name();
        if (translator.load(":/i18n/" + baseName)) {
            a.installTranslator(&translator);
            break;
        }
    }
    QFontDatabase::addApplicationFont(":/font/GUI Files/chronotype/ChronoType.ttf");
    QFont chronotype("ChronoType",18);
    a.setFont(chronotype);
    a.setWindowIcon(QIcon(":/App Icon/GUI Files/App Icon/Enchanter.png"));

    static std::unordered_map<std::string, Enchant>enchant_list{};
    static std::unordered_map<std::string, Artifacts> artifact_list{};
    std::set<std::string> allPossibleTags{}, allAwakens{}, allUniques{};
    std::multimap<std::string, std::string> awakenedItemMap{};
    std::map<std::string_view, int> tagToIntMap{}, artifactToIntMap{}, awakenToIntMap{}, uniqueToIntMap{};
    std::unordered_map<std::string, double> oddsCache{};
    std::unordered_map<std::string,std::string> enchantToIconMap{};

    loadArtifacts(artifact_list);
    loadEnchants(enchant_list, allPossibleTags, allAwakens, allUniques);
    loadAwakens(awakenedItemMap);
    buildIntMaps(enchant_list, artifact_list, tagToIntMap, artifactToIntMap, awakenToIntMap, uniqueToIntMap, allPossibleTags, allUniques, allAwakens);
    buildCache(oddsCache);
    buildEnchantToIconMap(enchant_list,enchantToIconMap);

    std::unordered_map<int, std::string> reverseEnchantIDMap{};
    for (const auto& enchant : enchant_list)
        reverseEnchantIDMap.emplace(enchant.second.enchantID, enchant.first);
    //Parameters paramObject{};
    /*
    std::filesystem::path fontPath = std::filesystem::current_path() /= "GUI Files";
    fontPath /= "chronotype";
    fontPath /= "ChronoType.ttf";
    QString fontPath2 = QString::fromStdString(fontPath.string());
    QFontDatabase::addApplicationFont(fontPath2);
    */

    MainWindow w(enchant_list,artifact_list,awakenedItemMap,tagToIntMap,artifactToIntMap,awakenToIntMap,uniqueToIntMap,oddsCache,reverseEnchantIDMap,enchantToIconMap);
    w.show();


    return a.exec();
}
