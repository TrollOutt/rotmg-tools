/****************************************************************************
** Meta object code from reading C++ file 'Parameters.h'
**
** Created by: The Qt Meta Object Compiler version 69 (Qt 6.11.0)
**
** WARNING! All changes made in this file will be lost!
*****************************************************************************/

#include "../../../Parameters.h"
#include <QtCore/qmetatype.h>

#include <QtCore/qtmochelpers.h>

#include <memory>


#include <QtCore/qxptype_traits.h>
#if !defined(Q_MOC_OUTPUT_REVISION)
#error "The header file 'Parameters.h' doesn't include <QObject>."
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
        "typeChanged",
        "",
        "modsChanged",
        "slotsChanged",
        "desiredChanged",
        "lockedAmountChanged",
        "nameChanged",
        "setType",
        "std::string",
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
        "newName"
    };

    QtMocHelpers::UintData qt_methods {
        // Signal 'typeChanged'
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
        // Slot 'setType'
        QtMocHelpers::SlotData<void(std::string)>(8, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 9, 10 },
        }}),
        // Slot 'setLockedMods'
        QtMocHelpers::SlotData<void(std::unordered_set<std::string>)>(11, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 12, 13 },
        }}),
        // Slot 'setSlots'
        QtMocHelpers::SlotData<void(int)>(14, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Int, 15 },
        }}),
        // Slot 'setDesired'
        QtMocHelpers::SlotData<void(std::string)>(16, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 9, 17 },
        }}),
        // Slot 'setLockedAmount'
        QtMocHelpers::SlotData<void(int)>(18, 2, QMC::AccessPublic, QMetaType::Void, {{
            { QMetaType::Int, 19 },
        }}),
        // Slot 'setName'
        QtMocHelpers::SlotData<void(std::string)>(20, 2, QMC::AccessPublic, QMetaType::Void, {{
            { 0x80000000 | 9, 21 },
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
        case 0: _t->typeChanged(); break;
        case 1: _t->modsChanged(); break;
        case 2: _t->slotsChanged(); break;
        case 3: _t->desiredChanged(); break;
        case 4: _t->lockedAmountChanged(); break;
        case 5: _t->nameChanged(); break;
        case 6: _t->setType((*reinterpret_cast<std::add_pointer_t<std::string>>(_a[1]))); break;
        case 7: _t->setLockedMods((*reinterpret_cast<std::add_pointer_t<std::unordered_set<std::string>>>(_a[1]))); break;
        case 8: _t->setSlots((*reinterpret_cast<std::add_pointer_t<int>>(_a[1]))); break;
        case 9: _t->setDesired((*reinterpret_cast<std::add_pointer_t<std::string>>(_a[1]))); break;
        case 10: _t->setLockedAmount((*reinterpret_cast<std::add_pointer_t<int>>(_a[1]))); break;
        case 11: _t->setName((*reinterpret_cast<std::add_pointer_t<std::string>>(_a[1]))); break;
        default: ;
        }
    }
    if (_c == QMetaObject::IndexOfMethod) {
        if (QtMocHelpers::indexOfMethod<void (Parameters::*)()>(_a, &Parameters::typeChanged, 0))
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
        if (_id < 12)
            qt_static_metacall(this, _c, _id, _a);
        _id -= 12;
    }
    if (_c == QMetaObject::RegisterMethodArgumentMetaType) {
        if (_id < 12)
            *reinterpret_cast<QMetaType *>(_a[0]) = QMetaType();
        _id -= 12;
    }
    return _id;
}

// SIGNAL 0
void Parameters::typeChanged()
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
QT_WARNING_POP
