'use strict';
/*
 * Where a client may be. ROTMG_CLIENT names one and is then the only place
 * looked at: a download that went missing must fail, not quietly fall back on
 * whatever older build happens to be installed.
 */
const path = require('path');

module.exports = process.env.ROTMG_CLIENT
  ? [path.resolve(process.env.ROTMG_CLIENT)]
  : [
    path.join(process.env.LOCALAPPDATA || '', 'RealmOfTheMadGod', 'Production'),
    'C:/Program Files (x86)/Steam/steamapps/common/Realm of the Mad God Exalt'
  ];
