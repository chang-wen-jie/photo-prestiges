// makkelijker verstreken targets ophalen (dan telkens deadline checken)
const mongoose = require('mongoose');

const closedTargetSchema = new mongoose.Schema({
    targetId: { type: String, required: true, unique: true }
});

module.exports = mongoose.model('ClosedTarget', closedTargetSchema);