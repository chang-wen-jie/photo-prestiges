const mongoose = require('mongoose');

const participantSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true }
});

module.exports = mongoose.model('Participant', participantSchema);