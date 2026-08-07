/****************************************************************************
** Meta object code from reading C++ file 'Classes+Functions.h'
**
** Created by: The Qt Meta Object Compiler version 69 (Qt 6.11.0)
**
** WARNING! All changes made in this file will be lost!
*****************************************************************************/

#include "../../../Classes+Functions.h"
#include <QtCore/qmetatype.h>

#include <QtCore/qtmochelpers.h>

#include <memory>


#include <QtCore/qxptype_traits.h>
#if !defined(Q_MOC_OUTPUT_REVISION)
#error "The header file 'Classes+Functions.h' doesn't include <QObject>."
#elif Q_MOC_OUTPUT_REVISION != 69
#error "This file was generated using the moc from 6.11.0. It"
#error "cannot be used with the include files from this version of Qt."
#error "(The moc has changed too much.)"
#endif

#ifndef Q_CONSTINIT
#define Q_CONSTINIT
#endif

QT_WARNING_PUSH
QT_WARNING_DISABLE_DEPRECATED
QT_WARNING_DISABLE_GCC("-Wuseless-cast")
namespace {
struct qt_meta_tag_ZN10ParametersE_t {};
} // unnamed namespace

template <> constexpr inline auto Parameters::qt_create_metaobjectdata<qt_meta_tag_ZN10ParametersE_t>()
{
    namespace QMC = QtMocConstants;
    QtMocHelpers::StringRefStorage qt_stringData {
        "Parameters",
        "baseChanged",
        "",
        "modsChanged",
        "slotsChanged",
        "desiredChanged",
        "lockedAmountChanged",
        "nameChanged",
        "dustChanged",
        "tiersChanged",
        "specialBaseTypesChanged",
        "setType",
        "newType",
        "setLockedMods",
        "std::unordered_set<std::string>",
        "newLockedMods",
        "setSlots",
        "newSlotAmount",
        "setDesired",
        "newDesired",
        "setLockedAmount",
        "newLockedAmount",
        "setName",
        "newName",
        "setDustType",
        "newDust",
        "setTiers",
        "numeral",
        "Qt::CheckState",
        "state",
        "setSpecialBaseTypes",
        "baseType"
    };

    QtMocHelpers::UintData qt_methods {
        // Signal 'baseChanged'
        QtMocHelpers::SignalData<void()>(1, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'modsChanged'
        QtMocHelpers::SignalData<void()>(3, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'slotsChanged'
        QtMocHelpers::SignalData<void()>(4, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'desiredChanged'
        QtMocHelpers::SignalData<void()>(5, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'lockedAmountChanged'
        QtMocHelpers::SignalData<void()>(6, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'nameChanged'
        QtMocHelpers::SignalData<void()>(7, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'dustChanged'
        QtMocHelpers::SignalData<void()>(8, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'tiersChanged'
        QtMocHelpers::SignalData<void()>(9, 2, QMC::AccessPublic, QMetaType::Void),
        // Signal 'specialBaseTypesChanged'
        QtMocHelpers::SignalData<void()>(10, 2, QMC::AccessPublic, QMetaType::Void),
        // Slot 'setType'
        QtMocHelpers::SlotData<void(QString)>(11, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::QString, 12 },
        }}),
        // Slot 'setLockedMods'
        QtMocHelpers::SlotData<void(std::unordered_set<std::string>)>(13, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 14, 15 },
        }}),
        // Slot 'setSlots'
        QtMocHelpers::SlotData<void(int)>(16, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Int, 17 },
        }}),
        // Slot 'setDesired'
        QtMocHelpers::SlotData<void(QString)>(18, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::QString, 19 },
        }}),
        // Slot 'setLockedAmount'
        QtMocHelpers::SlotData<void(int)>(20, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Int, 21 },
        }}),
        // Slot 'setName'
        QtMocHelpers::SlotData<void(QString)>(22, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::QString, 23 },
        }}),
        // Slot 'setDustType'
        QtMocHelpers::SlotData<void(QString)>(24, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::QString, 25 },
        }}),
        // Slot 'setTiers'
        QtMocHelpers::SlotData<void(QString, Qt::CheckState)>(26, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::QString, 27 }, { 0x80000000 | 28, 29 },
        }}),
        // Slot 'setSpecialBaseTypes'
        QtMocHelpers::SlotData<void(QString, Qt::CheckState)>(30, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::QString, 31 }, { 0x80000000 | 28, 29 },
        }}),
    };
    QtMocHelpers::UintData qt_properties {
    };
    QtMocHelpers::UintData qt_enums {
    };
    return QtMocHelpers::metaObjectData<Parameters, qt_meta_tag_ZN10ParametersE_t>(QMC::MetaObjectFlag{}, qt_stringData,
            qt_methods, qt_properties, qt_enums);
}
Q_CONSTINIT const QMetaObject Parameters::staticMetaObject = { {
    QMetaObject::SuperData::link<QObject::staticMetaObject>(),
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN10ParametersE_t>.stringdata,
    qt_staticMetaObjectStaticContent<qt_meta_tag_ZN10ParametersE_t>.data,
    qt_static_metacall,
    nullptr,
    qt_staticMetaObjectRelocatingContent<qt_meta_tag_ZN10ParametersE_t>.metaTypes,
    nullptr
} };

void Parameters::qt_static_metacall(QObject *_o, QMetaObject::Call _c, int _id, void **_a)
{
    auto *_t = static_cast<Parameters *>(_o);
    if (_c == QMetaObject::InvokeMetaMethod) {
        switch (_id) {
        case 0: _t->baseChanged(); break;
        case 1: _t->modsChanged(); break;
        case 2: _t->slotsChanged(); break;
        case 3: _t->desiredChanged(); break;
        case 4: _t->lockedAmountChanged(); break;
        case 5: _t->nameChanged(); break;
        case 6: _t->dustChanged(); break;
        case 7: _t->tiersChanged(); break;
        case 8: _t->specialBaseTypesChanged(); break;
        case 9: _t->setType((*reinterpret_cast<std::add_pointer_t<QString>>(_a[1]))); break;
        case 10: _t->setLockedMods((*reinterpret_cast<std::add_pointer_t<std::unordered_set<std::string>>>(_a[1]))); break;
        case 11: _t->setSlots((*reinterpret_cast<std::add_pointer_t<int>>(_a[1]))); break;
        case 12: _t->setDesired((*reinterpret_cast<std::add_pointer_t<QString>>(_a[1]))); break;
        case 13: _t->setLockedAmount((*reinterpret_cast<std::add_pointer_t<int>>(_a[1]))); break;
        case 14: _t->setName((*reinterpret_cast<std::add_pointer_t<QString>>(_a[1]))); break;
        case 15: _t->setDustType((*reinterpret_cast<std::add_pointer_t<QString>>(_a[1]))); break;
        case 16: _t->setTiers((*reinterpret_cast<std::add_pointer_t<QString>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<Qt::CheckState>>(_a[2]))); break;
        case 17: _t->setSpecialBaseTypes((*reinterpret_cast<std::add_pointer_t<QString>>(_a[1])),(*reinterpret_cast<std::add_pointer_t<Qt::CheckState>>(_a[2]))); break;
        default: ;
        }
    }
    if (_c == QMetaObject::IndexOfMethod) {
        if (QtMocHelpers::indexOfMethod<void (Parameters::*)()>(_a, &Parameters::baseChanged, 0))
            return;
        if (QtMocHelpers::indexOfMethod<void (Parameters::*)()>(_a, &Parameters::modsChanged, 1))
            return;
        if (QtMocHelpers::indexOfMethod<void (Parameters::*)()>(_a, &Parameters::slotsChanged, 2))
            return;
        if (QtMocHelpers::indexOfMethod<void (Parameters::*)()>(_a, &Parameters::desiredChanged, 3))
            return;
        if (QtMocHelpers::indexOfMethod<void (Parameters::*)()>(_a, &Parameters::lockedAmountChanged, 4))
            return;
        if (QtMocHelpers::indexOfMethod<void (Parameters::*)()>(_a, &Parameters::nameChanged, 5))
            return;
        if (QtMocHelpers::indexOfMethod<void (Parameters::*)()>(_a, &Parameters::dustChanged, 6))
            return;
        if (QtMocHelpers::indexOfMethod<void (Parameters::*)()>(_a, &Parameters::tiersChanged, 7))
            return;
        if (QtMocHelpers::indexOfMethod<void (Parameters::*)()>(_a, &Parameters::specialBaseTypesChanged, 8))
            return;
    }
}

const QMetaObject *Parameters::metaObject() const
{
    return QObject::d_ptr->metaObject ? QObject::d_ptr->dynamicMetaObject() : &staticMetaObject;
}

void *Parameters::qt_metacast(const char *_clname)
{
    if (!_clname) return nullptr;
    if (!strcmp(_clname, qt_staticMetaObjectStaticContent<qt_meta_tag_ZN10ParametersE_t>.strings))
        return static_cast<void*>(this);
    return QObject::qt_metacast(_clname);
}

int Parameters::qt_metacall(QMetaObject::Call _c, int _id, void **_a)
{
    _id = QObject::qt_metacall(_c, _id, _a);
    if (_id < 0)
        return _id;
    if (_c == QMetaObject::InvokeMetaMethod) {
        if (_id < 18)
            qt_static_metacall(this, _c, _id, _a);
        _id -= 18;
    }
    if (_c == QMetaObject::RegisterMethodArgumentMetaType) {
        if (_id < 18)
            *reinterpret_cast<QMetaType *>(_a[0]) = QMetaType();
        _id -= 18;
    }
    return _id;
}

// SIGNAL 0
void Parameters::baseChanged()
{
    QMetaObject::activate(this, &staticMetaObject, 0, nullptr);
}

// SIGNAL 1
void Parameters::modsChanged()
{
    QMetaObject::activate(this, &staticMetaObject, 1, nullptr);
}

// SIGNAL 2
void Parameters::slotsChanged()
{
    QMetaObject::activate(this, &staticMetaObject, 2, nullptr);
}

// SIGNAL 3
void Parameters::desiredChanged()
{
    QMetaObject::activate(this, &staticMetaObject, 3, nullptr);
}

// SIGNAL 4
void Parameters::lockedAmountChanged()
{
    QMetaObject::activate(this, &staticMetaObject, 4, nullptr);
}

// SIGNAL 5
void Parameters::nameChanged()
{
    QMetaObject::activate(this, &staticMetaObject, 5, nullptr);
}

// SIGNAL 6
void Parameters::dustChanged()
{
    QMetaObject::activate(this, &staticMetaObject, 6, nullptr);
}

// SIGNAL 7
void Parameters::tiersChanged()
{
    QMetaObject::activate(this, &staticMetaObject, 7, nullptr);
}

// SIGNAL 8
void Parameters::specialBaseTypesChanged()
{
    QMetaObject::activate(this, &staticMetaObject, 8, nullptr);
}
QT_WARNING_POP
