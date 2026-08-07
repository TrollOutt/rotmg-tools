/********************************************************************************
** Form generated from reading UI file 'mainwindow.ui'
**
** Created by: Qt User Interface Compiler version 6.11.0
**
** WARNING! All changes made in this file will be lost when recompiling UI file!
********************************************************************************/

#ifndef UI_MAINWINDOW_H
#define UI_MAINWINDOW_H

#include <QtCore/QVariant>
#include <QtGui/QAction>
#include <QtWidgets/QApplication>
#include <QtWidgets/QComboBox>
#include <QtWidgets/QHeaderView>
#include <QtWidgets/QListWidget>
#include <QtWidgets/QMainWindow>
#include <QtWidgets/QMenu>
#include <QtWidgets/QMenuBar>
#include <QtWidgets/QPushButton>
#include <QtWidgets/QStatusBar>
#include <QtWidgets/QTableWidget>
#include <QtWidgets/QWidget>

QT_BEGIN_NAMESPACE

class Ui_MainWindow
{
public:
    QWidget *centralwidget;
    QTableWidget *resultsWidget;
    QPushButton *CalculateButton;
    QComboBox *rarityWidget;
    QComboBox *dustTypeWidget;
    QComboBox *itemTypeWidget;
    QComboBox *awakenedItemWidget;
    QComboBox *desiredModWidget;
    QComboBox *locked1Widget;
    QComboBox *locked2Widget;
    QComboBox *locked3Widget;
    QPushButton *clear1Widget;
    QPushButton *clear3Widget;
    QPushButton *clear2Widget;
    QTableWidget *tierWidget;
    QPushButton *specialBaseButton;
    QListWidget *specialBaseList;
    QPushButton *clearDesiredWidget;
    QWidget *specialIconWidget;
    QMenuBar *menubar;
    QMenu *menuEnchant_Calculator;
    QStatusBar *statusbar;

    void setupUi(QMainWindow *MainWindow)
    {
        if (MainWindow->objectName().isEmpty())
            MainWindow->setObjectName("MainWindow");
        MainWindow->resize(1326, 850);
        QSizePolicy sizePolicy(QSizePolicy::Policy::Fixed, QSizePolicy::Policy::Preferred);
        sizePolicy.setHorizontalStretch(0);
        sizePolicy.setVerticalStretch(0);
        sizePolicy.setHeightForWidth(MainWindow->sizePolicy().hasHeightForWidth());
        MainWindow->setSizePolicy(sizePolicy);
        MainWindow->setStyleSheet(QString::fromUtf8(""));
        centralwidget = new QWidget(MainWindow);
        centralwidget->setObjectName("centralwidget");
        resultsWidget = new QTableWidget(centralwidget);
        if (resultsWidget->columnCount() < 5)
            resultsWidget->setColumnCount(5);
        QFont font;
        font.setPointSize(14);
        font.setBold(false);
        QTableWidgetItem *__qtablewidgetitem = new QTableWidgetItem();
        __qtablewidgetitem->setFont(font);
        resultsWidget->setHorizontalHeaderItem(0, __qtablewidgetitem);
        QFont font1;
        font1.setPointSize(14);
        QTableWidgetItem *__qtablewidgetitem1 = new QTableWidgetItem();
        __qtablewidgetitem1->setFont(font1);
        resultsWidget->setHorizontalHeaderItem(1, __qtablewidgetitem1);
        QTableWidgetItem *__qtablewidgetitem2 = new QTableWidgetItem();
        __qtablewidgetitem2->setFont(font1);
        resultsWidget->setHorizontalHeaderItem(2, __qtablewidgetitem2);
        QTableWidgetItem *__qtablewidgetitem3 = new QTableWidgetItem();
        __qtablewidgetitem3->setFont(font1);
        resultsWidget->setHorizontalHeaderItem(3, __qtablewidgetitem3);
        QTableWidgetItem *__qtablewidgetitem4 = new QTableWidgetItem();
        __qtablewidgetitem4->setFont(font1);
        resultsWidget->setHorizontalHeaderItem(4, __qtablewidgetitem4);
        resultsWidget->setObjectName("resultsWidget");
        resultsWidget->setGeometry(QRect(630, 10, 681, 791));
        resultsWidget->setFont(font1);
        resultsWidget->setFrameShape(QFrame::Shape::NoFrame);
        resultsWidget->setLineWidth(0);
        resultsWidget->setSizeAdjustPolicy(QAbstractScrollArea::SizeAdjustPolicy::AdjustToContents);
        resultsWidget->setIconSize(QSize(40, 40));
        resultsWidget->setTextElideMode(Qt::TextElideMode::ElideNone);
        resultsWidget->setGridStyle(Qt::PenStyle::DashDotLine);
        resultsWidget->horizontalHeader()->setCascadingSectionResizes(true);
        resultsWidget->horizontalHeader()->setDefaultSectionSize(110);
        resultsWidget->horizontalHeader()->setHighlightSections(false);
        resultsWidget->horizontalHeader()->setProperty("showSortIndicator", QVariant(true));
        resultsWidget->horizontalHeader()->setStretchLastSection(true);
        resultsWidget->verticalHeader()->setVisible(false);
        resultsWidget->verticalHeader()->setCascadingSectionResizes(true);
        resultsWidget->verticalHeader()->setDefaultSectionSize(45);
        CalculateButton = new QPushButton(centralwidget);
        CalculateButton->setObjectName("CalculateButton");
        CalculateButton->setEnabled(false);
        CalculateButton->setGeometry(QRect(450, 760, 151, 31));
        QPalette palette;
        QBrush brush(QColor(208, 138, 5, 255));
        brush.setStyle(Qt::BrushStyle::SolidPattern);
        palette.setBrush(QPalette::ColorGroup::Active, QPalette::ColorRole::Button, brush);
        QBrush brush1(QColor(31, 155, 93, 255));
        brush1.setStyle(Qt::BrushStyle::SolidPattern);
        palette.setBrush(QPalette::ColorGroup::Active, QPalette::ColorRole::Highlight, brush1);
        palette.setBrush(QPalette::ColorGroup::Inactive, QPalette::ColorRole::Button, brush);
        palette.setBrush(QPalette::ColorGroup::Inactive, QPalette::ColorRole::Highlight, brush1);
        palette.setBrush(QPalette::ColorGroup::Disabled, QPalette::ColorRole::Button, brush);
        palette.setBrush(QPalette::ColorGroup::Disabled, QPalette::ColorRole::Highlight, brush1);
        CalculateButton->setPalette(palette);
        QFont font2;
        font2.setPointSize(24);
        CalculateButton->setFont(font2);
        CalculateButton->setAutoFillBackground(true);
        rarityWidget = new QComboBox(centralwidget);
        QIcon icon;
        icon.addFile(QString::fromUtf8(":/Item Rarities/GUI Files/Item Rarities/uncommon_scaled_8x.png"), QSize(), QIcon::Mode::Normal, QIcon::State::Off);
        rarityWidget->addItem(icon, QString());
        QIcon icon1;
        icon1.addFile(QString::fromUtf8(":/Item Rarities/GUI Files/Item Rarities/rare_scaled_8x.png"), QSize(), QIcon::Mode::Normal, QIcon::State::Off);
        rarityWidget->addItem(icon1, QString());
        QIcon icon2;
        icon2.addFile(QString::fromUtf8(":/Item Rarities/GUI Files/Item Rarities/legendary_scaled_8x.png"), QSize(), QIcon::Mode::Normal, QIcon::State::Off);
        rarityWidget->addItem(icon2, QString());
        QIcon icon3;
        icon3.addFile(QString::fromUtf8(":/Item Rarities/GUI Files/Item Rarities/divine_scaled_8x.png"), QSize(), QIcon::Mode::Normal, QIcon::State::Off);
        rarityWidget->addItem(icon3, QString());
        rarityWidget->setObjectName("rarityWidget");
        rarityWidget->setGeometry(QRect(30, 10, 211, 71));
        QFont font3;
        font3.setPointSize(21);
        rarityWidget->setFont(font3);
        rarityWidget->setStyleSheet(QString::fromUtf8(""));
        rarityWidget->setEditable(false);
        rarityWidget->setIconSize(QSize(32, 32));
        rarityWidget->setFrame(true);
        dustTypeWidget = new QComboBox(centralwidget);
        QIcon icon4;
        icon4.addFile(QString::fromUtf8(":/Dust Types/GUI Files/Dust Types/Green.png"), QSize(), QIcon::Mode::Normal, QIcon::State::Off);
        dustTypeWidget->addItem(icon4, QString());
        QIcon icon5;
        icon5.addFile(QString::fromUtf8(":/Dust Types/GUI Files/Dust Types/Red.png"), QSize(), QIcon::Mode::Normal, QIcon::State::Off);
        dustTypeWidget->addItem(icon5, QString());
        QIcon icon6;
        icon6.addFile(QString::fromUtf8(":/Dust Types/GUI Files/Dust Types/Purple.png"), QSize(), QIcon::Mode::Normal, QIcon::State::Off);
        dustTypeWidget->addItem(icon6, QString());
        dustTypeWidget->setObjectName("dustTypeWidget");
        dustTypeWidget->setGeometry(QRect(440, 10, 181, 71));
        dustTypeWidget->setFont(font3);
        dustTypeWidget->setIconSize(QSize(40, 40));
        itemTypeWidget = new QComboBox(centralwidget);
        QIcon icon7;
        icon7.addFile(QString::fromUtf8(":/Item Types/GUI Files/Item Types/weapon.png"), QSize(), QIcon::Mode::Normal, QIcon::State::Off);
        itemTypeWidget->addItem(icon7, QString());
        QIcon icon8;
        icon8.addFile(QString::fromUtf8(":/Item Types/GUI Files/Item Types/ability.png"), QSize(), QIcon::Mode::Normal, QIcon::State::Off);
        itemTypeWidget->addItem(icon8, QString());
        QIcon icon9;
        icon9.addFile(QString::fromUtf8(":/Item Types/GUI Files/Item Types/armor.png"), QSize(), QIcon::Mode::Normal, QIcon::State::Off);
        itemTypeWidget->addItem(icon9, QString());
        QIcon icon10;
        icon10.addFile(QString::fromUtf8(":/Item Types/GUI Files/Item Types/ring.png"), QSize(), QIcon::Mode::Normal, QIcon::State::Off);
        itemTypeWidget->addItem(icon10, QString());
        itemTypeWidget->setObjectName("itemTypeWidget");
        itemTypeWidget->setGeometry(QRect(250, 10, 181, 71));
        itemTypeWidget->setFont(font3);
        itemTypeWidget->setIconSize(QSize(40, 40));
        awakenedItemWidget = new QComboBox(centralwidget);
        awakenedItemWidget->setObjectName("awakenedItemWidget");
        awakenedItemWidget->setGeometry(QRect(30, 90, 311, 71));
        QFont font4;
        font4.setPointSize(16);
        awakenedItemWidget->setFont(font4);
        awakenedItemWidget->setIconSize(QSize(40, 40));
        awakenedItemWidget->setModelColumn(0);
        desiredModWidget = new QComboBox(centralwidget);
        desiredModWidget->setObjectName("desiredModWidget");
        desiredModWidget->setGeometry(QRect(10, 190, 471, 61));
        QFont font5;
        font5.setPointSize(18);
        desiredModWidget->setFont(font5);
        desiredModWidget->setStyleSheet(QString::fromUtf8("QComboBox\n"
"{\n"
"	padding-left: 3px;\n"
"	padding-right: 0px;\n"
"}\n"
""));
        desiredModWidget->setSizeAdjustPolicy(QComboBox::SizeAdjustPolicy::AdjustToMinimumContentsLengthWithIcon);
        desiredModWidget->setIconSize(QSize(54, 54));
        locked1Widget = new QComboBox(centralwidget);
        locked1Widget->setObjectName("locked1Widget");
        locked1Widget->setEnabled(false);
        locked1Widget->setGeometry(QRect(10, 290, 471, 61));
        locked1Widget->setFont(font5);
        locked1Widget->setStyleSheet(QString::fromUtf8("QComboBox\n"
"{\n"
"	padding-left: 3px;\n"
"	padding-right: 0px;\n"
"}\n"
""));
        locked1Widget->setEditable(false);
        locked1Widget->setIconSize(QSize(54, 54));
        locked2Widget = new QComboBox(centralwidget);
        locked2Widget->setObjectName("locked2Widget");
        locked2Widget->setEnabled(false);
        locked2Widget->setGeometry(QRect(10, 350, 471, 61));
        locked2Widget->setFont(font5);
        locked2Widget->setStyleSheet(QString::fromUtf8("QComboBox\n"
"{\n"
"	padding-left: 3px;\n"
"	padding-right: 0px;\n"
"}\n"
""));
        locked2Widget->setIconSize(QSize(54, 54));
        locked3Widget = new QComboBox(centralwidget);
        locked3Widget->setObjectName("locked3Widget");
        locked3Widget->setEnabled(false);
        locked3Widget->setGeometry(QRect(10, 410, 471, 61));
        locked3Widget->setFont(font5);
        locked3Widget->setStyleSheet(QString::fromUtf8("QComboBox\n"
"{\n"
"	padding-left: 3px;\n"
"	padding-right: 0px;\n"
"}\n"
""));
        locked3Widget->setIconSize(QSize(54, 54));
        clear1Widget = new QPushButton(centralwidget);
        clear1Widget->setObjectName("clear1Widget");
        clear1Widget->setEnabled(false);
        clear1Widget->setGeometry(QRect(460, 290, 20, 20));
        QSizePolicy sizePolicy1(QSizePolicy::Policy::Ignored, QSizePolicy::Policy::Ignored);
        sizePolicy1.setHorizontalStretch(0);
        sizePolicy1.setVerticalStretch(0);
        sizePolicy1.setHeightForWidth(clear1Widget->sizePolicy().hasHeightForWidth());
        clear1Widget->setSizePolicy(sizePolicy1);
        QFont font6;
        font6.setPointSize(8);
        font6.setBold(false);
        font6.setHintingPreference(QFont::PreferDefaultHinting);
        clear1Widget->setFont(font6);
        clear1Widget->setStyleSheet(QString::fromUtf8("QPushButton\n"
"{\n"
"background-color: rgb(130, 20, 20);\n"
"color: white;\n"
"border-style: outset;\n"
"border-width: 2px;\n"
"border-color: rgb(80,0,0);\n"
"padding: 0px;\n"
"border-radius: 4px;\n"
"text-align: center;\n"
"}\n"
"QPushButton:pressed\n"
"{\n"
"background-color: rgb(100,10,10);\n"
"border-style: inset;\n"
"\n"
"}\n"
"QPushButton:Hover\n"
"{\n"
"background-color: rgb(160,30,30);\n"
"}\n"
""));
        clear3Widget = new QPushButton(centralwidget);
        clear3Widget->setObjectName("clear3Widget");
        clear3Widget->setEnabled(false);
        clear3Widget->setGeometry(QRect(460, 410, 20, 20));
        QFont font7;
        font7.setPointSize(8);
        font7.setBold(false);
        clear3Widget->setFont(font7);
        clear3Widget->setStyleSheet(QString::fromUtf8("QPushButton\n"
"{\n"
"background-color: rgb(130, 20, 20);\n"
"color: white;\n"
"border-style: outset;\n"
"border-width: 2px;\n"
"border-color: rgb(80,0,0);\n"
"padding: 0px;\n"
"border-radius: 4px;\n"
"}\n"
"QPushButton:pressed\n"
"{\n"
"background-color: rgb(100,10,10);\n"
"border-style: inset;\n"
"\n"
"}\n"
"QPushButton:Hover\n"
"{\n"
"background-color: rgb(160,30,30);\n"
"}\n"
""));
        clear2Widget = new QPushButton(centralwidget);
        clear2Widget->setObjectName("clear2Widget");
        clear2Widget->setEnabled(false);
        clear2Widget->setGeometry(QRect(460, 350, 20, 20));
        clear2Widget->setFont(font7);
        clear2Widget->setStyleSheet(QString::fromUtf8("QPushButton\n"
"{\n"
"background-color: rgb(130, 20, 20);\n"
"color: white;\n"
"border-style: outset;\n"
"border-width: 2px;\n"
"border-color: rgb(80,0,0);\n"
"padding: 0px;\n"
"border-radius: 4px;\n"
"}\n"
"QPushButton:pressed\n"
"{\n"
"background-color: rgb(100,10,10);\n"
"border-style: inset;\n"
"\n"
"}\n"
"QPushButton:Hover\n"
"{\n"
"background-color: rgb(160,30,30);\n"
"}\n"
""));
        tierWidget = new QTableWidget(centralwidget);
        if (tierWidget->columnCount() < 2)
            tierWidget->setColumnCount(2);
        QTableWidgetItem *__qtablewidgetitem5 = new QTableWidgetItem();
        tierWidget->setHorizontalHeaderItem(0, __qtablewidgetitem5);
        QTableWidgetItem *__qtablewidgetitem6 = new QTableWidgetItem();
        tierWidget->setHorizontalHeaderItem(1, __qtablewidgetitem6);
        if (tierWidget->rowCount() < 2)
            tierWidget->setRowCount(2);
        QTableWidgetItem *__qtablewidgetitem7 = new QTableWidgetItem();
        tierWidget->setVerticalHeaderItem(0, __qtablewidgetitem7);
        QTableWidgetItem *__qtablewidgetitem8 = new QTableWidgetItem();
        tierWidget->setVerticalHeaderItem(1, __qtablewidgetitem8);
        QTableWidgetItem *__qtablewidgetitem9 = new QTableWidgetItem();
        __qtablewidgetitem9->setCheckState(Qt::Checked);
        __qtablewidgetitem9->setFlags(Qt::ItemIsEnabled);
        tierWidget->setItem(0, 0, __qtablewidgetitem9);
        QTableWidgetItem *__qtablewidgetitem10 = new QTableWidgetItem();
        __qtablewidgetitem10->setCheckState(Qt::Checked);
        __qtablewidgetitem10->setFlags(Qt::ItemIsEnabled);
        tierWidget->setItem(0, 1, __qtablewidgetitem10);
        QTableWidgetItem *__qtablewidgetitem11 = new QTableWidgetItem();
        __qtablewidgetitem11->setCheckState(Qt::Checked);
        __qtablewidgetitem11->setFlags(Qt::ItemIsEnabled);
        tierWidget->setItem(1, 0, __qtablewidgetitem11);
        QTableWidgetItem *__qtablewidgetitem12 = new QTableWidgetItem();
        __qtablewidgetitem12->setCheckState(Qt::Checked);
        __qtablewidgetitem12->setFlags(Qt::ItemIsEnabled);
        tierWidget->setItem(1, 1, __qtablewidgetitem12);
        tierWidget->setObjectName("tierWidget");
        tierWidget->setGeometry(QRect(490, 190, 131, 61));
        tierWidget->setStyleSheet(QString::fromUtf8("\n"
"QTableWidget \n"
"{\n"
"    outline: 0;\n"
"	border: 1px solid #333333;\n"
"	border-radius: 4px;\n"
"	background-clip: padding;\n"
"}\n"
"\n"
"QTableWidget::item {\n"
"    background-color: transparent; \n"
"}\n"
"QTableWidget::item:hover {\n"
"    background-color: transparent;\n"
"}\n"
"QTableWidget::item:selected {\n"
"    background-color: transparent;\n"
"    color: inherit;\n"
"}\n"
"QTableWidget::item:focus {\n"
"    background-color: transparent;\n"
"    border: none;\n"
"}\n"
"\n"
"QAbstractItemView::indicator {\n"
"    border-radius: 4px;\n"
"}\n"
"QAbstractItemView::indicator:unchecked\n"
"{\n"
" border-radius: 4px;\n"
" background-color: rgb(59, 59, 59);\n"
"}\n"
"QAbstractItemView::indicator:unchecked:hover\n"
"{\n"
"    border-radius: 4px;\n"
"background-color: rgb(79, 79, 79);\n"
"}\n"
"QAbstractItemView::indicator:checked:hover\n"
"{\n"
"border-radius: 4px;\n"
"background-color: rgb(111, 205, 86); \n"
"}\n"
"QAbstractItemView::indicator:checked\n"
"{ \n"
"border: 1px solid rgb(21, 31, 15);"
                        "\n"
"background-color: rgb(141, 255, 116); \n"
" }"));
        tierWidget->setFrameShape(QFrame::Shape::NoFrame);
        tierWidget->setVerticalScrollBarPolicy(Qt::ScrollBarPolicy::ScrollBarAlwaysOff);
        tierWidget->setHorizontalScrollBarPolicy(Qt::ScrollBarPolicy::ScrollBarAlwaysOff);
        tierWidget->setSizeAdjustPolicy(QAbstractScrollArea::SizeAdjustPolicy::AdjustIgnored);
        tierWidget->setAutoScroll(false);
        tierWidget->setEditTriggers(QAbstractItemView::EditTrigger::NoEditTriggers);
        tierWidget->setTextElideMode(Qt::TextElideMode::ElideNone);
        tierWidget->setVerticalScrollMode(QAbstractItemView::ScrollMode::ScrollPerItem);
        tierWidget->setShowGrid(true);
        tierWidget->setGridStyle(Qt::PenStyle::DotLine);
        tierWidget->setSupportedDragActions(Qt::DropAction::IgnoreAction);
        tierWidget->horizontalHeader()->setVisible(false);
        tierWidget->horizontalHeader()->setCascadingSectionResizes(true);
        tierWidget->horizontalHeader()->setDefaultSectionSize(65);
        tierWidget->verticalHeader()->setVisible(false);
        specialBaseButton = new QPushButton(centralwidget);
        specialBaseButton->setObjectName("specialBaseButton");
        specialBaseButton->setGeometry(QRect(350, 90, 271, 71));
        specialBaseButton->setFont(font3);
        specialBaseButton->setFocusPolicy(Qt::FocusPolicy::NoFocus);
        specialBaseButton->setContextMenuPolicy(Qt::ContextMenuPolicy::NoContextMenu);
        specialBaseButton->setStyleSheet(QString::fromUtf8("text-align: left;\n"
"padding-left: 6px;\n"
"color: rgb(149, 149, 149)"));
        specialBaseButton->setIconSize(QSize(40, 40));
        specialBaseList = new QListWidget(centralwidget);
        QIcon icon11;
        icon11.addFile(QString::fromUtf8(":/Item Types/GUI Files/Item Types/SUMMONPOWERED.png"), QSize(), QIcon::Mode::Normal, QIcon::State::Off);
        QListWidgetItem *__qlistwidgetitem = new QListWidgetItem(specialBaseList);
        __qlistwidgetitem->setCheckState(Qt::Unchecked);
        __qlistwidgetitem->setIcon(icon11);
        __qlistwidgetitem->setFlags(Qt::ItemIsEnabled);
        QIcon icon12;
        icon12.addFile(QString::fromUtf8(":/Item Types/GUI Files/Item Types/ALIEN.png"), QSize(), QIcon::Mode::Normal, QIcon::State::Off);
        QListWidgetItem *__qlistwidgetitem1 = new QListWidgetItem(specialBaseList);
        __qlistwidgetitem1->setCheckState(Qt::Unchecked);
        __qlistwidgetitem1->setIcon(icon12);
        __qlistwidgetitem1->setFlags(Qt::ItemIsEnabled);
        QIcon icon13;
        icon13.addFile(QString::fromUtf8(":/Item Types/GUI Files/Item Types/NEO_ALIEN.png"), QSize(), QIcon::Mode::Normal, QIcon::State::Off);
        QListWidgetItem *__qlistwidgetitem2 = new QListWidgetItem(specialBaseList);
        __qlistwidgetitem2->setCheckState(Qt::Unchecked);
        __qlistwidgetitem2->setIcon(icon13);
        __qlistwidgetitem2->setFlags(Qt::ItemIsEnabled);
        specialBaseList->setObjectName("specialBaseList");
        specialBaseList->setGeometry(QRect(350, 160, 271, 161));
        specialBaseList->setMinimumSize(QSize(0, 0));
        specialBaseList->setFont(font4);
        specialBaseList->setStyleSheet(QString::fromUtf8("QListWidget \n"
"{\n"
"    outline: 0;\n"
"}\n"
"\n"
"QListWidget::item {\n"
"    background-color: transparent; \n"
"}\n"
"QListWidget::item:hover {\n"
"    background-color: transparent;\n"
"}\n"
"QListWidget::item:selected {\n"
"    background-color: transparent;\n"
"    color: inherit;\n"
"}\n"
"QListWidget::item:focus {\n"
"    background-color: transparent;\n"
"    border: none;\n"
"}\n"
"\n"
"\n"
"\n"
"QAbstractItemView::indicator {\n"
"    border-radius: 4px;\n"
"}\n"
"QAbstractItemView::indicator:unchecked\n"
"{\n"
" border-radius: 4px;\n"
" background-color: rgb(59, 59, 59);\n"
"}\n"
"QAbstractItemView::indicator:unchecked:hover\n"
"{\n"
"    border-radius: 4px;\n"
"background-color: rgb(79, 79, 79);\n"
"}\n"
"QAbstractItemView::indicator:checked:hover\n"
"{\n"
"border-radius: 4px;\n"
"background-color: rgb(111, 205, 86); \n"
"}\n"
"QAbstractItemView::indicator:checked\n"
"{ \n"
"border: 1px solid rgb(21, 31, 15);\n"
"background-color: rgb(141, 255, 116); \n"
" }"));
        specialBaseList->setVerticalScrollBarPolicy(Qt::ScrollBarPolicy::ScrollBarAlwaysOff);
        specialBaseList->setHorizontalScrollBarPolicy(Qt::ScrollBarPolicy::ScrollBarAlwaysOff);
        specialBaseList->setAutoScroll(false);
        specialBaseList->setIconSize(QSize(40, 40));
        specialBaseList->setFlow(QListView::Flow::TopToBottom);
        specialBaseList->setViewMode(QListView::ViewMode::ListMode);
        specialBaseList->setItemAlignment(Qt::AlignmentFlag::AlignLeading);
        clearDesiredWidget = new QPushButton(centralwidget);
        clearDesiredWidget->setObjectName("clearDesiredWidget");
        clearDesiredWidget->setGeometry(QRect(460, 190, 20, 20));
        clearDesiredWidget->setFont(font7);
        clearDesiredWidget->setStyleSheet(QString::fromUtf8("QPushButton\n"
"{\n"
"background-color: rgb(130, 20, 20);\n"
"color: white;\n"
"border-style: outset;\n"
"border-width: 2px;\n"
"border-color: rgb(80,0,0);\n"
"padding: 0px;\n"
"border-radius: 4px;\n"
"}\n"
"QPushButton:pressed\n"
"{\n"
"background-color: rgb(100,10,10);\n"
"border-style: inset;\n"
"\n"
"}\n"
"QPushButton:Hover\n"
"{\n"
"background-color: rgb(160,30,30);\n"
"}\n"
""));
        specialIconWidget = new QWidget(centralwidget);
        specialIconWidget->setObjectName("specialIconWidget");
        specialIconWidget->setGeometry(QRect(350, 90, 271, 71));
        QSizePolicy sizePolicy2(QSizePolicy::Policy::Preferred, QSizePolicy::Policy::Preferred);
        sizePolicy2.setHorizontalStretch(0);
        sizePolicy2.setVerticalStretch(0);
        sizePolicy2.setHeightForWidth(specialIconWidget->sizePolicy().hasHeightForWidth());
        specialIconWidget->setSizePolicy(sizePolicy2);
        MainWindow->setCentralWidget(centralwidget);
        specialBaseButton->raise();
        resultsWidget->raise();
        CalculateButton->raise();
        rarityWidget->raise();
        dustTypeWidget->raise();
        itemTypeWidget->raise();
        awakenedItemWidget->raise();
        desiredModWidget->raise();
        locked1Widget->raise();
        locked2Widget->raise();
        locked3Widget->raise();
        clear1Widget->raise();
        clear3Widget->raise();
        clear2Widget->raise();
        tierWidget->raise();
        clearDesiredWidget->raise();
        specialBaseList->raise();
        specialIconWidget->raise();
        menubar = new QMenuBar(MainWindow);
        menubar->setObjectName("menubar");
        menubar->setGeometry(QRect(0, 0, 1326, 21));
        menuEnchant_Calculator = new QMenu(menubar);
        menuEnchant_Calculator->setObjectName("menuEnchant_Calculator");
        MainWindow->setMenuBar(menubar);
        statusbar = new QStatusBar(MainWindow);
        statusbar->setObjectName("statusbar");
        MainWindow->setStatusBar(statusbar);

        menubar->addAction(menuEnchant_Calculator->menuAction());

        retranslateUi(MainWindow);

        rarityWidget->setCurrentIndex(-1);
        dustTypeWidget->setCurrentIndex(-1);
        itemTypeWidget->setCurrentIndex(-1);


        QMetaObject::connectSlotsByName(MainWindow);
    } // setupUi

    void retranslateUi(QMainWindow *MainWindow)
    {
        MainWindow->setWindowTitle(QCoreApplication::translate("MainWindow", "MainWindow", nullptr));
        QTableWidgetItem *___qtablewidgetitem = resultsWidget->horizontalHeaderItem(0);
        ___qtablewidgetitem->setText(QCoreApplication::translate("MainWindow", "Artifact", nullptr));
        QTableWidgetItem *___qtablewidgetitem1 = resultsWidget->horizontalHeaderItem(1);
        ___qtablewidgetitem1->setText(QCoreApplication::translate("MainWindow", "Odds", nullptr));
        QTableWidgetItem *___qtablewidgetitem2 = resultsWidget->horizontalHeaderItem(2);
        ___qtablewidgetitem2->setText(QCoreApplication::translate("MainWindow", "Dust Cost", nullptr));
        QTableWidgetItem *___qtablewidgetitem3 = resultsWidget->horizontalHeaderItem(3);
        ___qtablewidgetitem3->setText(QCoreApplication::translate("MainWindow", "Add. Cost", nullptr));
        QTableWidgetItem *___qtablewidgetitem4 = resultsWidget->horizontalHeaderItem(4);
        ___qtablewidgetitem4->setText(QCoreApplication::translate("MainWindow", "Artifacts Used", nullptr));
        CalculateButton->setText(QCoreApplication::translate("MainWindow", "ENCHANT", nullptr));
        rarityWidget->setItemText(0, QCoreApplication::translate("MainWindow", " Uncommon", nullptr));
        rarityWidget->setItemText(1, QCoreApplication::translate("MainWindow", " Rare", nullptr));
        rarityWidget->setItemText(2, QCoreApplication::translate("MainWindow", " Legendary", nullptr));
        rarityWidget->setItemText(3, QCoreApplication::translate("MainWindow", " Divine", nullptr));

        rarityWidget->setCurrentText(QString());
        rarityWidget->setPlaceholderText(QCoreApplication::translate("MainWindow", "<rarity>", nullptr));
        dustTypeWidget->setItemText(0, QCoreApplication::translate("MainWindow", "Green", nullptr));
        dustTypeWidget->setItemText(1, QCoreApplication::translate("MainWindow", "Red", nullptr));
        dustTypeWidget->setItemText(2, QCoreApplication::translate("MainWindow", "Purple", nullptr));

        dustTypeWidget->setPlaceholderText(QCoreApplication::translate("MainWindow", "<dust type>", nullptr));
        itemTypeWidget->setItemText(0, QCoreApplication::translate("MainWindow", "WEAPON", nullptr));
        itemTypeWidget->setItemText(1, QCoreApplication::translate("MainWindow", "ABILITY", nullptr));
        itemTypeWidget->setItemText(2, QCoreApplication::translate("MainWindow", "ARMOR", nullptr));
        itemTypeWidget->setItemText(3, QCoreApplication::translate("MainWindow", "RING", nullptr));

        itemTypeWidget->setPlaceholderText(QCoreApplication::translate("MainWindow", "<item type>", nullptr));
        awakenedItemWidget->setPlaceholderText(QCoreApplication::translate("MainWindow", "<awakens>", nullptr));
        desiredModWidget->setPlaceholderText(QCoreApplication::translate("MainWindow", "<desired mod>", nullptr));
        locked1Widget->setPlaceholderText(QCoreApplication::translate("MainWindow", "~~", nullptr));
        locked2Widget->setPlaceholderText(QCoreApplication::translate("MainWindow", "~~", nullptr));
        locked3Widget->setPlaceholderText(QCoreApplication::translate("MainWindow", "~~", nullptr));
        clear1Widget->setText(QCoreApplication::translate("MainWindow", "X", nullptr));
        clear3Widget->setText(QCoreApplication::translate("MainWindow", "X", nullptr));
        clear2Widget->setText(QCoreApplication::translate("MainWindow", "X", nullptr));

        const bool __sortingEnabled = tierWidget->isSortingEnabled();
        tierWidget->setSortingEnabled(false);
        QTableWidgetItem *___qtablewidgetitem5 = tierWidget->item(0, 0);
        ___qtablewidgetitem5->setText(QCoreApplication::translate("MainWindow", "I", nullptr));
        QTableWidgetItem *___qtablewidgetitem6 = tierWidget->item(0, 1);
        ___qtablewidgetitem6->setText(QCoreApplication::translate("MainWindow", "II", nullptr));
        QTableWidgetItem *___qtablewidgetitem7 = tierWidget->item(1, 0);
        ___qtablewidgetitem7->setText(QCoreApplication::translate("MainWindow", "III", nullptr));
        QTableWidgetItem *___qtablewidgetitem8 = tierWidget->item(1, 1);
        ___qtablewidgetitem8->setText(QCoreApplication::translate("MainWindow", "IV", nullptr));
        tierWidget->setSortingEnabled(__sortingEnabled);

        specialBaseButton->setText(QCoreApplication::translate("MainWindow", "<subtypes>", nullptr));

        const bool __sortingEnabled1 = specialBaseList->isSortingEnabled();
        specialBaseList->setSortingEnabled(false);
        QListWidgetItem *___qlistwidgetitem = specialBaseList->item(0);
        ___qlistwidgetitem->setText(QCoreApplication::translate("MainWindow", "SUMMONPOWERED", nullptr));
        QListWidgetItem *___qlistwidgetitem1 = specialBaseList->item(1);
        ___qlistwidgetitem1->setText(QCoreApplication::translate("MainWindow", "ALIEN", nullptr));
        QListWidgetItem *___qlistwidgetitem2 = specialBaseList->item(2);
        ___qlistwidgetitem2->setText(QCoreApplication::translate("MainWindow", "NEO_ALIEN", nullptr));
        specialBaseList->setSortingEnabled(__sortingEnabled1);

        clearDesiredWidget->setText(QCoreApplication::translate("MainWindow", "X", nullptr));
        menuEnchant_Calculator->setTitle(QCoreApplication::translate("MainWindow", "Enchant Calculator", nullptr));
    } // retranslateUi

};

namespace Ui {
    class MainWindow: public Ui_MainWindow {};
} // namespace Ui

QT_END_NAMESPACE

#endif // UI_MAINWINDOW_H
