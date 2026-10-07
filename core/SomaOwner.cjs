/**
 * core/SomaOwner.cjs
 * Single source of truth for the current user's identity.
 * Reads from config/owner.json — change that file to personalise SOMA for a new user.
 */
const fs   = require('fs');
const path = require('path');

let _owner = null;

function getOwner() {
  if (_owner) return _owner;
  try {
    const p = path.join(process.cwd(), 'config', 'owner.json');
    _owner = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    _owner = { name: 'User', pronouns: 'they/them' };
  }
  return _owner;
}

function ownerName() {
  return getOwner().name;
}

module.exports = { getOwner, ownerName };
