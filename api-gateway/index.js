require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const { createProxyMiddleware } = require('http-proxy-middleware');
const axios = require('axios');
const CircuitBreaker = require('opossum');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');

const app = express();
const PORT = process.env.PORT;
const swaggerDocument = YAML.load('./swagger.yaml');

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

const verifyToken = (req, res, next) => {
    if (req.path === '/auth/login' || req.path === '/auth/register') {
        return next();
    }

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Ongeldige gegevens' });
    }

    try {
        const verified = jwt.verify(token, process.env.JWT_SECRET);
        req.user = verified;
        
        req.headers['x-user-id'] = verified.id;
        req.headers['x-user-role'] = verified.role;
        next();
    } catch (err) {
        return res.status(403).json({ message: 'Ongeldige token' });
    }
};

app.use(verifyToken);

app.use('/auth', createProxyMiddleware({ 
    target: process.env.AUTH_SERVICE_URL, 
    changeOrigin: true 
}));

app.use('/targets', createProxyMiddleware({ 
    target: process.env.TARGET_SERVICE_URL, 
    changeOrigin: true 
}));

app.use('/participate', createProxyMiddleware({ 
    target: process.env.PARTICIPATION_SERVICE_URL, 
    changeOrigin: true,
}));

// handmatige createProxyMiddleware voor CircuitBreaker
const fetchFromReadService = async (req) => {
    const response = await axios({
        method: req.method,
        url: `http://localhost:3006${req.path}`,
        params: req.query, // filter
        headers: { 
            'Authorization': req.headers['authorization'],
            'x-user-id': req.headers['x-user-id'],
            'x-user-role': req.headers['x-user-role']
        }
    });
    return response.data;
};

const breakerOptions = {
    timeout: 3000,
    errorThresholdPercentage: 50,
    resetTimeout: 10000
};

const readServiceBreaker = new CircuitBreaker(fetchFromReadService, breakerOptions);

readServiceBreaker.fallback(() => {
    return { error: 'read-service is offline...' };
});

app.use('/explore', async (req, res) => {
    try {
        const data = await readServiceBreaker.fire(req);
        
        if (data.error) {
            return res.status(503).json(data);
        }
        
        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ error: 'api-gateway routing error' });
    }
});

app.listen(PORT, () => {
    console.log(`api-gateway draait op poort: ${PORT}`);
});