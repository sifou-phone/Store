// Communes per wilaya, for the order form dropdown (see scripts/build-communes.py).
const data = require('./data/communes.json');

function communesFor(code) {
  const list = data.communes[String(Number(code))] || [];
  return list.map(([ar, fr]) => ({ ar, fr }));
}

module.exports = { communesFor };
