#ifndef MAINWINDOW_H
#define MAINWINDOW_H

#include <QMainWindow>
#include "Classes+Functions.h"
//#include "Enchant.h"

QT_BEGIN_NAMESPACE
namespace Ui {
class MainWindow;
}
QT_END_NAMESPACE

class MainWindow : public QMainWindow
{
    Q_OBJECT

public:
    Ui::MainWindow *ui;
    void extracted();
    explicit MainWindow(
        const std::unordered_map<std::string, Enchant>& enchant_list,
        const std::unordered_map<std::string, Artifacts>& artifact_list,
        const std::multimap<std::string, std::string>& awakenedItemMap,
        const std::map<std::string_view, int>& tagToIntMap,
        const std::map<std::string_view, int>& artifactToIntMap,
        const std::map<std::string_view, int>& awakenToIntMap,
        const std::map<std::string_view, int>& uniqueToIntMap,
        const std::unordered_map<std::string, double>& oddsCache,
        const std::unordered_map<int, std::string>& reverseEnchantIDMap,
        const std::unordered_map<std::string,std::string>& enchantToIconMap,
        QWidget *parent = nullptr);
    ~MainWindow() override;

private:

    std::multimap<std::string,std::string> awakenedItemMap{};
    std::unordered_map<std::string,bool> modButtonInformer{};
    std::unordered_map<std::string,bool> desiredInformer{};
    //std::unordered_map<int, std::string> reverseEnchantIDMap{};
    void setCurrentIndex(int);
    void pressed();

protected:
    bool eventFilter(QObject *watched, QEvent *event) override;
};
#endif // MAINWINDOW_H
