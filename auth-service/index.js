require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");

const { registerUser, loginUser } = require('./services/AuthService');

const app = express();
app.use(express.json());

const verifyInternalApiKey = (req, res, next) => {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey || apiKey !== process.env.INTERNAL_API_KEY) {
    return res
      .status(403)
      .json({ error: "Toegang geweigerd: Ongeldige interne API key" });
  }
  next();
};
app.use(verifyInternalApiKey);

const PORT = process.env.PORT;
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("1️⃣ auth-service: Verbonden met MongoDB"))
  .catch((err) => console.error("1️⃣ auth-service: MongoDB error: ", err));

app.post("/register", async (req, res) => {
  try {
    const { username, password, role } = req.body;
    await registerUser(username, password, role);
    res.status(201).json({ message: "Gebruiker geregistreerd" });
  } catch (error) {
    res.status(500).json({ error: "Gebruiker registreren mislukt" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const token = await loginUser(username, password);
    res.status(200).json({ message: "Gebruiker ingelogd", token });
  } catch (error) {
    if (error.message === "INVALID_CREDENTIALS") {
        return res.status(401).json({ message: "Ongeldige gegevens" });
    }
    res.status(500).json({ error: "Gebruiker inloggen mislukt" });
  }
});

app.listen(PORT, () => {
  console.log(`1️⃣ auth-service: Draait op poort ${PORT}`);
});
