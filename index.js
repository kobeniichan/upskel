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
app.use(express.static("public"));

// Buat folder tmp jika belum ada
const tmpDir = "/tmp";
if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
}

// Konfigurasi multer untuk menyimpan file di /tmp
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
const upload = multer({ storage });

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
        });

        const { code } = uploadResponse.data.data;
        console.log('[UPLOAD]', code);

        const params = { code, type, username, scaleRadio: scaleRatio.toString() };

        // Poll for result
        let result;
        for (let i = 0; i < 1000; i++) {
            const statusResponse = await axios.post('https://photoai.imglarger.com/api/PhoAi/CheckStatus', JSON.stringify(params), {
                headers: {
                    'User-Agent': 'Dart/3.5 (dart:io)',
                    'Accept-Encoding': 'gzip',
                    'Content-Type': 'application/json',
                },
            });

            result = statusResponse.data.data;
            console.log(`[CHECK ${i + 1}]`, result.status);

            if (result.status === 'success') break;
            await new Promise(resolve => setTimeout(resolve, 500));
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

// Endpoint untuk enhance image
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
        const response = await axios.get(enhancedUrl, { responseType: 'arraybuffer' });
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

// Serve file langsung dari root URL
app.use(express.static(tmpDir));

module.exports = app;
