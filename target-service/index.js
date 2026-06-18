require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");

const mongoose = require("mongoose");
const multer = require("multer");

const { createTarget, getAllTargets, deleteTarget } = require('./services/TargetService');

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
  .then(() => console.log("2️⃣ target-service: Verbonden met MongoDB"))
  .catch((err) => console.error("2️⃣ target-service: MongoDB error: ", err));

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
app.use("/uploads", express.static(uploadDir));
const storage = multer.diskStorage({
  // onthou afbeeldingen na service ctrl+c
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) =>
    cb(null, `target_${Date.now()}${path.extname(file.originalname)}`),
});
const upload = multer({ storage: storage });

app.post("/", upload.single("image"), async (req, res) => {
  try {
    const fileUrl = req.file ? `/uploads/${req.file.filename}` : null;
    const target = await createTarget(req.headers["x-user-id"], req.headers["x-user-role"], req.body.locationDescription, req.body.deadline, fileUrl);
    res.status(201).json({ message: "Target aangemaakt", target });
  } catch (error) {
    if (error.message === "UNAUTHORIZED") return res.status(403).json({ error: "Alleen owners kunnen targets aanmaken" });
    if (error.message === "NO_FILE") return res.status(400).json({ error: "Afbeelding is verplicht" });
    res.status(500).json({ error: "Target aanmaken mislukt" });
  }
});

app.get("/", async (req, res) => {
  try {
    res.status(200).json(await getAllTargets());
  } catch (error) {
    res.status(500).json({ error: "Targets ophalen mislukt" });
  }
});

app.delete("/:id", async (req, res) => {
  try {
    await deleteTarget(req.params.id, req.headers["x-user-id"], __dirname);
    res.status(200).json({ message: "Target verwijderd" });
  } catch (error) {
    if (error.message === "NOT_FOUND") return res.status(404).json({ error: "Target niet gevonden" });
    if (error.message === "UNAUTHORIZED") return res.status(403).json({ error: "Niet geauthoriseerd" });
    res.status(500).json({ error: "Target verwijderen mislukt" });
  }
});

app.listen(PORT, () => {
  console.log(`2️⃣ target-service: Draait op poort: ${PORT}`);
});
