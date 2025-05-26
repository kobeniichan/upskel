const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const axios = require('axios');
const FormData = require('form-data');
const crypto = require('crypto');

const app = express();
app.use(cors());

// Serve static files from current directory (for index.html)
app.use(express.static(__dirname));

// Use /tmp for file storage on Vercel
const tmpDir = "/tmp";
if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
}

// Configure multer for file storage in /tmp
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, tmpDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const filename = Date.now() + ext;
        cb(null, filename);
    },
});
const upload = multer({ 
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// Image enhancer function
const generateUsername = () => `${crypto.randomBytes(8).toString('hex')}_aiimglarger`;

const enhanceImage = async (buffer, filename = 'temp.jpg', scaleRatio = 4, type = 0) => {
    try {
        const username = generateUsername();

        // Upload image
        const formData = new FormData();
        formData.append('type', type);
        formData.append('username', username);
        formData.append('scaleRadio', scaleRatio.toString());
        formData.append('file', buffer, { filename, contentType: 'image/jpeg' });

        const uploadResponse = await axios.post('https://photoai.imglarger.com/api/PhoAi/Upload', formData, {
            headers: {
                ...formData.getHeaders(),
                'User-Agent': 'Dart/3.5 (dart:io)',
                'Accept-Encoding': 'gzip',
            },
            timeout: 30000 // 30 second timeout
        });

        const { code } = uploadResponse.data.data;
        console.log('[UPLOAD]', code);

        const params = { code, type, username, scaleRadio: scaleRatio.toString() };

        // Poll for result with timeout
        let result;
        const maxAttempts = 60; // Reduce from 1000 to avoid timeout
        for (let i = 0; i < maxAttempts; i++) {
            const statusResponse = await axios.post('https://photoai.imglarger.com/api/PhoAi/CheckStatus', JSON.stringify(params), {
                headers: {
                    'User-Agent': 'Dart/3.5 (dart:io)',
                    'Accept-Encoding': 'gzip',
                    'Content-Type': 'application/json',
                },
                timeout: 10000 // 10 second timeout
            });

            result = statusResponse.data.data;
            console.log(`[CHECK ${i + 1}]`, result.status);

            if (result.status === 'success') break;
            if (result.status === 'error') throw new Error('Enhancement failed');
            
            await new Promise(resolve => setTimeout(resolve, 1000)); // Increase delay to 1 second
        }

        if (result.status === 'success') {
            return result.downloadUrls[0];
        } else {
            throw new Error('Enhancement failed after maximum polling attempts.');
        }
    } catch (error) {
        console.error('[ERROR]', error.message || error);
        throw error;
    }
};

// Serve enhanced images from /tmp
app.get('/enhanced_:filename', (req, res) => {
    const filename = 'enhanced_' + req.params.filename;
    const filePath = path.join(tmpDir, filename);
    
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).json({ error: 'File not found' });
    }
});

// Root route to serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Endpoint for image enhancement
app.post("/api/enhance", upload.single("image"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
    }

    try {
        // Get enhancement options from request
        const scaleRatio = parseInt(req.body.scaleRatio) || 4;
        const type = parseInt(req.body.type) || 0;

        // Read uploaded file
        const buffer = fs.readFileSync(req.file.path);
        
        // Enhance image
        const enhancedUrl = await enhanceImage(buffer, req.file.originalname, scaleRatio, type);
        
        // Download enhanced image
        const response = await axios.get(enhancedUrl, { 
            responseType: 'arraybuffer',
            timeout: 30000 // 30 second timeout
        });
        const enhancedBuffer = Buffer.from(response.data);
        
        // Save enhanced image locally
        const enhancedFilename = `enhanced_${Date.now()}.jpg`;
        const enhancedPath = path.join(tmpDir, enhancedFilename);
        fs.writeFileSync(enhancedPath, enhancedBuffer);
        
        // Clean up original file
        fs.unlinkSync(req.file.path);
        
        // Return local URL for enhanced image
        const localUrl = `${req.protocol}://${req.get("host")}/${enhancedFilename}`;
        
        res.json({ 
            success: true,
            originalUrl: enhancedUrl,
            localUrl: localUrl,
            filename: enhancedFilename
        });
        
    } catch (error) {
        console.error('Enhancement error:', error);
        
        // Clean up original file if exists
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        
        res.status(500).json({ 
            error: "Image enhancement failed",
            details: error.message 
        });
    }
});

// For Vercel, export the app
module.exports = app;

// For local development
if (require.main === module) {
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
        console.log(`Server running on port ${port}`);
    });
}
