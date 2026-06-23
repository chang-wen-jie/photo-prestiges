require("dotenv").config();

const express = require("express");
const jwt = require("jsonwebtoken");

const axios = require("axios");
const CircuitBreaker = require("opossum");
const { createProxyMiddleware } = require("http-proxy-middleware");
const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");

const app = express();
const PORT = process.env.PORT;

const swaggerDocument = YAML.load("./swagger.yaml");
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

const verifyToken = (req, res, next) => {
  if (req.path === "/auth/login" || req.path === "/auth/register") {
    return next();
  }

  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Ongeldige gegevens" });
  }

  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified;

    req.headers["x-user-id"] = verified.id;
    req.headers["x-user-role"] = verified.role;
    next();
  } catch (err) {
    return res.status(403).json({ message: "Ongeldige token" });
  }
};
app.use(verifyToken);

const createProxyConfig = (targetUrl, pathPrefix) => {
  return {
    target: targetUrl,
    changeOrigin: true,
    pathRewrite: {
      [`^${pathPrefix}`]: "",
    },
    on: {
      proxyReq: (proxyReq, req, res) => {
        proxyReq.setHeader("x-api-key", process.env.INTERNAL_API_KEY);
      },
    },
  };
};

app.use(
  "/auth",
  createProxyMiddleware(
    createProxyConfig(process.env.AUTH_SERVICE_URL, "/auth"),
  ),
);
app.use(
  "/targets",
  createProxyMiddleware(
    createProxyConfig(process.env.TARGET_SERVICE_URL, "/targets"),
  ),
);
app.use(
  "/participate",
  createProxyMiddleware(
    createProxyConfig(process.env.PARTICIPATION_SERVICE_URL, "/participate"),
  ),
);

// handmatige createProxyMiddleware voor CircuitBreaker
const fetchFromReadService = async (req) => {
  const response = await axios({
    method: req.method,
    url: `${process.env.READ_SERVICE_URL}${req.path}`,
    params: req.query, // filter
    headers: {
      Authorization: req.headers["authorization"],
      "x-user-id": req.headers["x-user-id"],
      "x-user-role": req.headers["x-user-role"],
      "x-api-key": process.env.INTERNAL_API_KEY,
    },
  });
  return response.data;
};

const breakerOptions = {
  timeout: 3000,
  errorThresholdPercentage: 50,
  resetTimeout: 10000,
};
const readServiceBreaker = new CircuitBreaker(
  fetchFromReadService,
  breakerOptions,
);
readServiceBreaker.fallback(() => {
  return { error: "read-service is offline..." };
});

app.use("/explore", async (req, res) => {
  try {
    const data = await readServiceBreaker.fire(req);

    if (data.error) {
      return res.status(503).json(data);
    }

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: "0️⃣ api-gateway: Routing error" });
  }
});

app.listen(PORT, () => {
  console.log(`0️⃣ api-gateway: Draait op poort ${PORT}`);
});
