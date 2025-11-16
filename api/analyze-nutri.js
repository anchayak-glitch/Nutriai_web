/**
 * Netlify Serverless Function for NutriSense AI
 * Endpoint: /.netlify/functions/analyze-nutri or /api/analyze-nutri
 * * This function receives a meal list from the frontend, calls the Gemini API
 * to analyze the nutrition, and returns a structured JSON result.
 */

// Replace with your actual Gemini API Key from Netlify Environment Variables
// Netlify will automatically inject this environment variable called GEMINI_API_KEY.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "food-1234"; 
const MODEL_NAME = 'gemini-2.5-flash-preview-09-2025';

// Define the structured JSON output the model must follow
const NUTRITION_SCHEMA = {
    type: "OBJECT",
    properties: {
        calories: {
            type: "NUMBER",
            description: "Total estimated calories in Kcal (e.g., 650.5)."
        },
        protein: {
            type: "NUMBER",
            description: "Total estimated Protein in grams (g)."
        },
        sugar: {
            type: "NUMBER",
            description: "Total estimated Sugars (free sugars) in grams (g)."
        },
        satFat: {
            type: "NUMBER",
            description: "Total estimated Saturated Fat in grams (g)."
        },
        sodium: {
            type: "NUMBER",
            description: "Total estimated Sodium in milligrams (mg)."
        },
    },
    required: ["calories", "protein", "sugar", "satFat", "sodium"]
};

/**
 * Netlify Function Handler.
 * @param {Object} event - The event object from Netlify.
 * @returns {Object} - The response object.
 */
exports.handler = async (event) => {
    // 1. Validate HTTP Method
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method Not Allowed. Use POST.' }),
        };
    }
    
    // 2. Validate API Key
    if (!GEMINI_API_KEY) {
        console.error("GEMINI_API_KEY is missing from Netlify Environment Variables.");
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Server configuration error: API Key is missing.' }),
        };
    }

    let mealText;
    try {
        const body = JSON.parse(event.body);
        mealText = body.mealText;
        if (!mealText) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing mealText in request body.' }),
            };
        }
    } catch (e) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Invalid JSON body.' }),
        };
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${GEMINI_API_KEY}`;
    
    // System Instruction to guide the model's persona and task
    const systemPrompt = "คุณคือผู้เชี่ยวชาญด้านโภชนาการมืออาชีพ ทำหน้าที่วิเคราะห์รายการอาหารที่ผู้ใช้ให้มา และคำนวณสารอาหารหลัก 5 ชนิด (แคลอรี่, โปรตีน, น้ำตาล, ไขมันอิ่มตัว, โซเดียม) โดยประมาณ โดยให้ค่าเป็นตัวเลขเท่านั้น ห้ามใส่หน่วยในค่าตัวเลข และให้ผลลัพธ์เป็น JSON ตาม Schema ที่กำหนดอย่างเคร่งครัด";
    
    // User Query
    const userQuery = `โปรดวิเคราะห์สารอาหารของอาหารทั้งหมดต่อไปนี้ และรวมผลลัพธ์เป็นค่าเดียว: ${mealText}`;

    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: {
            parts: [{ text: systemPrompt }]
        },
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: NUTRITION_SCHEMA
        }
    };

    let responseJson;
    try {
        // Use exponential backoff for resilience in fetching
        const fetchWithRetry = async (url, options, retries = 3) => {
            for (let i = 0; i < retries; i++) {
                try {
                    const res = await fetch(url, options);
                    if (res.ok) return res;
                    if (res.status === 429 && i < retries - 1) { // Rate limit handling
                        const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
                        await new Promise(resolve => setTimeout(resolve, delay));
                        continue;
                    }
                    throw new Error(`API call failed with status: ${res.status}`);
                } catch (error) {
                    if (i === retries - 1) throw error;
                    const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        };

        const apiResponse = await fetchWithRetry(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        responseJson = await apiResponse.json();

        const candidate = responseJson.candidates?.[0];
        
        if (!candidate || !candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
             console.error("Gemini API returned an unexpected structure:", responseJson);
             throw new Error("Gemini API returned an invalid response structure.");
        }

        // The generated content is a JSON string due to responseMimeType
        const jsonString = candidate.content.parts[0].text;
        const parsedData = JSON.parse(jsonString);

        // Success response
        return {
            statusCode: 200,
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ success: true, data: parsedData }),
        };

    } catch (error) {
        console.error("Error calling Gemini API:", error);
        
        // Log the full response for debugging (if available)
        if (responseJson) {
            console.error("Full API Error Response:", JSON.stringify(responseJson, null, 2));
        }

        return {
            statusCode: 500,
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ error: `Internal server error: ${error.message}` }),
        };
    }
};