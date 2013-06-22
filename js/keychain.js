// Generated by CoffeeScript 1.6.2
/**
 * Read and write 1Password 4 Cloud Keychain files. Based on the documentation
 * at http://learn.agilebits.com/1Password4/Security/keychain-design.html
 * and https://github.com/Roguelazer/onepasswordpy
*/


(function() {
  var BAND_PREFIX, BAND_SUFFIX, Crypto, EventEmitter, Item, Keychain, Opdata, PROFILE_PREFIX, PROFILE_SUFFIX, fs,
    __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; };

  fs = require('fs');

  EventEmitter = require('events').EventEmitter;

  Crypto = require('./crypto');

  Opdata = require('./opdata');

  Item = require('./item');

  BAND_PREFIX = 'ld(';

  BAND_SUFFIX = ');';

  PROFILE_PREFIX = 'var profile=';

  PROFILE_SUFFIX = ';';

  Keychain = (function() {
    /**
     * Create a new keychain
     * - password  {String} : The master password for the keychain.
     * - [settings] {Object} : Extra options for the keychain, such as the hint
     *   and number of iterations
     * > {Keychain} - a new Keychain object
    */
    Keychain.create = function(password, settings) {
      var currentTime, key, keychain, keys, options, raw, superKey, _i, _len;

      if (settings == null) {
        settings = {};
      }
      currentTime = Math.floor(Date.now() / 1000);
      options = {
        uuid: Crypto.generateUuid(),
        salt: Crypto.randomBytes(16),
        createdAt: currentTime,
        updatedAt: currentTime,
        iterations: 2500,
        profileName: 'default',
        passwordHint: '',
        lastUpdatedBy: 'Dropbox'
      };
      for (_i = 0, _len = options.length; _i < _len; _i++) {
        key = options[_i];
        if (settings.hasOwnProperty(key)) {
          options[key] = settings[key];
        }
      }
      keychain = new Keychain(options);
      raw = {
        master: Crypto.randomBytes(256),
        overview: Crypto.randomBytes(64)
      };
      keys = {
        master: Crypto.hash(raw.master, 512, 'hex'),
        overview: Crypto.hash(raw.overview, 512, 'hex')
      };
      superKey = keychain._deriveKeys(password);
      keychain.encrypted = {
        masterKey: superKey.encrypt('profileKey', raw.master),
        overviewKey: superKey.encrypt('profileKey', raw.overview)
      };
      keychain.master = new Opdata(keys.master.slice(0, 64), keys.master.slice(64));
      keychain.overview = new Opdata(keys.overview.slice(0, 64), keys.overview.slice(64));
      return keychain;
    };

    /**
     * Constructs a new Keychain
     * - [attrs] {Object} : Load items
    */


    function Keychain(attrs) {
      this._autolock = __bind(this._autolock, this);      this.AUTOLOCK_LENGTH = 1 * 60 * 1000;
      this.event = new EventEmitter();
      this.profileName = 'default';
      this.items = {};
      this.unlocked = false;
      if (attrs) {
        this.loadAttrs(attrs);
      }
    }

    /**
     * Easy way to load data into a keychain
     * - {Object} attrs The attributes you want to load
     * > {this}
    */


    Keychain.prototype.loadAttrs = function(attrs) {
      var attr, key;

      for (key in attrs) {
        attr = attrs[key];
        this[key] = attr;
      }
      return this;
    };

    /**
     * Derive super keys from password using PBKDF2
     * - {String} password The master password.
     * > {Opdata} - the derived keys.
    */


    Keychain.prototype._deriveKeys = function(password) {
      var derived, keys;

      keys = Crypto.pbkdf2(password, this.salt, this.iterations);
      derived = {
        encryption: Crypto.toBuffer(keys.slice(0, 64)),
        hmac: Crypto.toBuffer(keys.slice(64))
      };
      return new Opdata(derived.encryption, derived.hmac);
    };

    /**
     * Load data from a .cloudKeychain folder
     * @param  {String} filepath The filepath of the .cloudKeychain file
     * @throws {Error} If profile.js can't be found
    */


    Keychain.prototype.load = function(keychainPath) {
      var attachments, bands, filename, folder, folderContents, folders, profile, _i, _len;

      this.keychainPath = keychainPath;
      this.profileFolder = "" + this.keychainPath + "/" + this.profileName;
      folderContents = fs.readdirSync(this.profileFolder);
      profile = null;
      folder = null;
      bands = [];
      attachments = [];
      for (_i = 0, _len = folderContents.length; _i < _len; _i++) {
        filename = folderContents[_i];
        if (filename === "profile.js") {
          profile = "" + this.profileFolder + "/profile.js";
        } else if (filename === "folders.js") {
          folders = "" + this.profileFolder + "/folders.js";
        } else if (filename.match(/^band_[0-9A-F]\.js$/)) {
          bands.push("" + this.profileFolder + "/" + filename);
        } else if (filename.match(/^[0-9A-F]{32}_[0-9A-F]{32}\.attachment$/)) {
          attachments.push(filename);
        }
      }
      if (profile != null) {
        this.loadProfile(profile);
      } else {
        throw new Error('Couldn\'t find profile.js');
      }
      if (folders != null) {
        this.loadFolders(folders);
      }
      if (bands.length > 0) {
        this.loadBands(bands);
      }
      if (attachments.length > 0) {
        this.loadAttachment(attachments);
      }
      return this;
    };

    /**
     * Load data from profile.js into keychain.
     * @param {String} filepath The path to the profile.js file.
     * @param {Boolean} [rawData=false] If set to true, 'filepath' will be considered the actual profile data to load from.
    */


    Keychain.prototype.loadProfile = function(filepath, rawData) {
      var data, json, profile;

      if (rawData) {
        data = filepath;
      } else {
        data = fs.readFileSync(filepath).toString();
      }
      json = data.slice(PROFILE_PREFIX.length, -PROFILE_SUFFIX.length);
      profile = JSON.parse(json);
      this.loadAttrs({
        uuid: profile.uuid,
        salt: Crypto.fromBase64(profile.salt),
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
        iterations: profile.iterations,
        profileName: profile.profileName,
        passwordHint: profile.passwordHint,
        lastUpdatedBy: profile.lastUpdatedBy
      });
      this.encrypted = {
        masterKey: Crypto.fromBase64(profile.masterKey),
        overviewKey: Crypto.fromBase64(profile.overviewKey)
      };
      return this;
    };

    /**
     * Load folders
     * @param  {String} filepath The path to the folders.js file.
    */


    Keychain.prototype.loadFolders = function(filepath) {};

    /**
     * This loads the item data from a band file into the keychain.
     * @param  {Array} bands An array of filepaths to each band file
    */


    Keychain.prototype.loadBands = function(bands) {
      var band, filepath, item, uuid, _i, _len;

      for (_i = 0, _len = bands.length; _i < _len; _i++) {
        filepath = bands[_i];
        band = fs.readFileSync(filepath).toString('utf8');
        band = band.slice(BAND_PREFIX.length, -BAND_SUFFIX.length);
        band = JSON.parse(band);
        for (uuid in band) {
          item = band[uuid];
          this.addItem(item);
        }
      }
      return this;
    };

    /**
     * Load attachments
     * @param  {Array} attachments An array of filepaths to each attachment file
    */


    Keychain.prototype.loadAttachment = function(attachments) {};

    /**
     * Change the keychain master password. Since the derived keys and raw key data aren't stored, the current password must be supplied to decrypt this data again. Though slower, this is more secure than keeping this data in memory.
     * @param {string} currentPassword The current master password.
     * @param {string} newPassword The password to change to.
    */


    Keychain.prototype.changePassword = function(currentPassword, newPassword) {
      var currentKey, masterKey, newKey, overviewKey;

      currentKey = this._deriveKeys(currentPassword);
      masterKey = currentKey.decrypt('buffer', this.encrypted.masterKey);
      overviewKey = currentKey.decrypt('buffer', this.encrypted.overviewKey);
      newKey = this._deriveKeys(newPassword);
      this.encrypted.masterKey = newKey.encrypt('profileKey', masterKey);
      this.encrypted.overviewKey = newKey.encrypt('profileKey', overviewKey);
      return this;
    };

    /**
     * Runs the master password through PBKDF2 to derive the super keys, and then
     * decrypt the masterKey and overviewKey. The master password and super keys
     * are then forgotten as they are no longer needed and keeping them in memory
     * will only be a security risk.
     *
     * @param  {String} password The master password to unlock the keychain
     *                           with.
     * @return {Boolean} Whether or not the keychain was unlocked successfully.
     *                   Which is an easy way to see if the master password was
     *                   correct.
    */


    Keychain.prototype.unlock = function(password) {
      var master, overview, profileKey,
        _this = this;

      if (this.unlocked) {
        console.log('Keychain already unlocked...');
        return;
      }
      profileKey = this._deriveKeys(password);
      master = profileKey.decrypt('profileKey', this.encrypted.masterKey);
      if (!master.length) {
        console.error('Could not decrypt master key');
        this.unlocked = false;
        return false;
      }
      overview = profileKey.decrypt('profileKey', this.encrypted.overviewKey);
      if (!overview.length) {
        console.error('Could not decrypt overview key');
        this.unlocked = false;
        return this;
      }
      this.master = new Opdata(master[0], master[1]);
      this.overview = new Opdata(overview[0], overview[1]);
      this.eachItem(function(item) {
        return item.unlock('overview');
      });
      this.unlocked = true;
      this.event.emit('unlock');
      this.rescheduleAutoLock();
      setTimeout((function() {
        return _this._autolock();
      }), 1000);
      return this;
    };

    /**
     * Lock the keychain. This discards all currently decrypted keys, overview
     * data and any decrypted item details.
     * @param {Boolean} autolock Whether the keychain was locked automatically.
    */


    Keychain.prototype.lock = function(autolock) {
      this.event.emit('lock:before', autolock);
      this["super"] = void 0;
      this.master = void 0;
      this.overview = void 0;
      this.items = {};
      this.unlocked = false;
      return this.event.emit('lock:after', autolock);
    };

    /**
     * Reschedule when the keychain is locked. Should be called only when the
     * user performs an important action, such as unlocking the keychain,
     * selecting an item or copying a password, so that it doesn't lock when
     * they are using it.
    */


    Keychain.prototype.rescheduleAutoLock = function() {
      return this.autoLockTime = Date.now() + this.AUTOLOCK_LENGTH;
    };

    /**
     * This is run every second, to check to see if the timer has expired. If it
     * has it then locks the keychain.
     * @private
    */


    Keychain.prototype._autolock = function() {
      var now;

      if (!this.unlocked) {
        return;
      }
      now = Date.now();
      if (now < this.autoLockTime) {
        setTimeout(this._autolock, 1000);
        return;
      }
      return this.lock(true);
    };

    /**
     * Expose Item.create so you only have to include this one file
     * @param {Object} data Item data.
     * @return {Object} An item instance.
    */


    Keychain.prototype.createItem = function(data) {
      return Item.create(this, data);
    };

    /**
     * Add an item to the keychain
     * @param {Object} item The item to add to the keychain
    */


    Keychain.prototype.addItem = function(item) {
      if (!(item instanceof Item)) {
        item = new Item(this).load(item);
      }
      this.items[item.uuid] = item;
      return this;
    };

    /**
     * This returns an item with the matching UUID
     * @param  {String} uuid The UUID to find the Item of
     * @return {Item} The item matching the UUID
    */


    Keychain.prototype.getItem = function(uuid) {
      return this.items[uuid];
    };

    /**
     * Search through all items
    */


    Keychain.prototype.findItems = function(query) {
      var item, items, uuid, _ref;

      items = [];
      _ref = this.items;
      for (uuid in _ref) {
        item = _ref[uuid];
        if (item.trashed) {
          continue;
        }
        if (item.match(query) === null) {
          continue;
        }
        items.push[item];
      }
      return items;
    };

    /**
     * Loop through all the items in the keychain, and pass each one to a
     * function.
     * @param  {Function} fn The function to pass each item to
    */


    Keychain.prototype.eachItem = function(fn) {
      var item, uuid, _ref, _results;

      _ref = this.items;
      _results = [];
      for (uuid in _ref) {
        item = _ref[uuid];
        _results.push(fn(item));
      }
      return _results;
    };

    /**
     * Generate the profile.js file
     * @return {String} The profile.js file
    */


    Keychain.prototype.exportProfile = function() {
      var data;

      data = {
        lastUpdatedBy: this.lastUpdatedBy,
        updatedAt: this.updatedAt,
        profileName: this.profileName,
        salt: this.salt.toString('base64'),
        passwordHint: this.passwordHint,
        masterKey: this.encrypted.masterKey.toString('base64'),
        iterations: this.iterations,
        uuid: this.uuid,
        overviewKey: this.encrypted.overviewKey.toString('base64'),
        createdAt: this.createdAt
      };
      return PROFILE_PREFIX + JSON.stringify(data) + PROFILE_SUFFIX;
    };

    /**
     * This exports all the items currently in the keychain into band files.
     * @return {Object} The band files
    */


    Keychain.prototype.exportBands = function() {
      var bands, data, files, id, item, items, uuid, _i, _len, _ref, _ref1;

      bands = {};
      _ref = this.items;
      for (uuid in _ref) {
        item = _ref[uuid];
        id = uuid.slice(0, 1);
        if ((_ref1 = bands[id]) == null) {
          bands[id] = [];
        }
        bands[id].push(item);
      }
      files = {};
      for (id in bands) {
        items = bands[id];
        data = {};
        for (_i = 0, _len = items.length; _i < _len; _i++) {
          item = items[_i];
          data[item.uuid] = item.toJSON();
        }
        data = BAND_PREFIX + JSON.stringify(data, null, 2) + BAND_SUFFIX;
        files["band_" + id + ".js"] = data;
      }
      return files;
    };

    return Keychain;

  })();

  module.exports = Keychain;

}).call(this);
