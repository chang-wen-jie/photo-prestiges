const Target = require("../models/Target");

async function getActiveTargets(locationFilter) {
  let query = { deadline: { $gt: new Date() } };
  if (locationFilter) {
    query.locationDescription = { $regex: locationFilter, $options: "i" };
  }
  return await Target.find(query);
}

module.exports = { getActiveTargets };
