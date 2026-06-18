const jwt = require("jsonwebtoken");

const User = require("../models/User");
const { publishEvent } = require("../utils/rabbitmq");

async function registerUser(username, password, role) {
  const user = new User({ username, password, role });
  await user.save();

  if (role === "participant") {
    await publishEvent("user_registered", { userId: user.username });
  }
  return user;
}

async function loginUser(username, password) {
  const user = await User.findOne({ username });
  if (!user || !(await user.comparePassword(password))) {
    throw new Error("INVALID_CREDENTIALS");
  }

  const token = jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "2h" },
  );
  return token;
}

module.exports = {
  registerUser,
  loginUser,
};
