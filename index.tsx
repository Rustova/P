
import React, { useState, useCallback, ChangeEvent, useEffect, DragEvent } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

// Define the API Key from environment variables
const API_KEY = process.env.API_KEY;

interface SingleMCQ {
    question: string;
    options: string[];
}

const App: React.FC = () => {
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [mcqData, setMcqData] = useState<SingleMCQ[] | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [copyButtonText, setCopyButtonText] = useState<string>("Copy All");
    const [copiedQuestionIndex, setCopiedQuestionIndex] = useState<number | null>(null);
    const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);

    const ai = API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : null;

    const handleFileSelected = (file: File | null) => {
        // Reset MCQ related states and error
        setMcqData(null);
        setError(null);
        setCopyButtonText("Copy All");
        setCopiedQuestionIndex(null);

        if (file) {
            if (file.type.startsWith('image/')) {
                setSelectedFile(file);
                setPreviewUrl(null); // Clear previous preview before loading new one
                const reader = new FileReader();
                reader.onloadend = () => {
                    setPreviewUrl(reader.result as string);
                };
                reader.readAsDataURL(file);
            } else {
                setSelectedFile(null);
                setPreviewUrl(null);
                setError(`Invalid file type: "${file.name}". Please upload an image file (e.g., JPG, PNG).`);
            }
        } else { // file is null (e.g., selection cleared or no valid file dropped)
            setSelectedFile(null);
            setPreviewUrl(null);
        }
    };
    
    const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        handleFileSelected(file || null);
    };

    const fileToGenerativePart = async (file: File) => {
        const base64EncodedDataPromise = new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
            reader.readAsDataURL(file);
        });
        return {
            inlineData: { data: await base64EncodedDataPromise, mimeType: file.type },
        };
    };

    const handleExtract = async () => {
        if (!selectedFile) {
            setError("Please select an image first."); 
            return;
        }
        if (!ai) {
            setError("Gemini AI client is not initialized. Check API Key.");
            return;
        }

        setIsLoading(true);
        setError(null);
        setMcqData(null);
        setCopyButtonText("Copy All");
        setCopiedQuestionIndex(null);

        try {
            const imagePart = await fileToGenerativePart(selectedFile);
            const textPart = {
                text: `Critically analyze the provided image to identify all multiple-choice questions and their corresponding options.
Your response MUST be a single, valid JSON array. Each element in the array MUST be a JSON object representing one question.
Each JSON object MUST contain exactly two keys:
1. "question": A string representing the full text of the question.
2. "options": An array of strings, where each string is an individual answer choice. Do NOT include any prefixes (e.g., 'a)', '1.') in these option strings.
Example output for two questions:
[
    {"question": "What is the capital of France?", "options": ["Berlin", "Paris", "Rome", "Madrid"]},
    {"question": "Which planet is known as the Red Planet?", "options": ["Earth", "Mars", "Jupiter", "Venus"]}
]
If no questions are found, return an empty array [].
ABSOLUTELY NO other text, explanations, or markdown formatting should precede or follow this JSON array.`
            };

            const response: GenerateContentResponse = await ai.models.generateContent({
                model: 'gemini-2.5-flash-preview-04-17',
                contents: { parts: [imagePart, textPart] },
                config: { responseMimeType: "application/json" }
            });

            let jsonStr = response.text.trim();
            const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
            const match = jsonStr.match(fenceRegex);
            if (match && match[2]) {
                jsonStr = match[2].trim();
            }

            const parsedData: SingleMCQ[] = JSON.parse(jsonStr);

            if (Array.isArray(parsedData) && parsedData.every(item => item && typeof item.question === 'string' && Array.isArray(item.options) && item.options.every(opt => typeof opt === 'string'))) {
                if (parsedData.length === 0) {
                    setMcqData([]);
                } else {
                    setMcqData(parsedData);
                }
            } else {
                setError("The model could not extract the questions correctly. The JSON format might be unexpected or data is missing.");
                console.error("Unexpected JSON structure:", parsedData);
                setMcqData(null);
            }

        } catch (err) {
            console.error("Error extracting MCQs:", err);
            setError("An error occurred while extracting the questions. Please try again or check the image format/content.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleCopyAll = useCallback(() => {
        if (mcqData && mcqData.length > 0) {
            let textToCopy = "";
            mcqData.forEach((mcq, qIndex) => {
                if (qIndex > 0) {
                    textToCopy += "\n\n";
                }
                textToCopy += `${mcq.question}\n\n`;
                mcq.options.forEach((option, oIndex) => {
                    textToCopy += `${String.fromCharCode(97 + oIndex)}. ${option}\n`;
                });
            });
            navigator.clipboard.writeText(textToCopy.trim())
                .then(() => {
                    setCopyButtonText("Copied!");
                    setTimeout(() => setCopyButtonText("Copy All"), 2000);
                })
                .catch(err => {
                    console.error("Failed to copy text: ", err);
                    setError("Failed to copy text."); 
                });
        }
    }, [mcqData]);

    const handleCopySingle = useCallback((qIndex: number) => {
        if (mcqData && mcqData[qIndex]) {
            const mcq = mcqData[qIndex];
            let textToCopy = `${mcq.question}\n\n`;
            mcq.options.forEach((option, oIndex) => {
                textToCopy += `${String.fromCharCode(97 + oIndex)}. ${option}\n`;
            });
            navigator.clipboard.writeText(textToCopy.trim())
                .then(() => {
                    setCopiedQuestionIndex(qIndex);
                    setTimeout(() => setCopiedQuestionIndex(null), 2000);
                })
                .catch(err => {
                    console.error("Failed to copy single question: ", err);
                    setError("Failed to copy question."); 
                });
        }
    }, [mcqData]);

    // Drag and Drop Handlers
    const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        setIsDraggingOver(true);
    };

    const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        if (!isDraggingOver) setIsDraggingOver(true); // Ensure it's true
    };

    const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        const dropZone = event.currentTarget;
        // Check if the element being left to is outside the drop zone
        if (event.relatedTarget && dropZone.contains(event.relatedTarget as Node)) {
            return; // Still inside the drop zone or one of its children
        }
        setIsDraggingOver(false);
    };

    const handleDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        setIsDraggingOver(false);
        const files = event.dataTransfer.files;
        if (files && files.length > 0) {
            handleFileSelected(files[0]);
        } else {
            handleFileSelected(null);
        }
    };
    
    if (!API_KEY || !ai) {
         return (
            <div className="status-message error" role="alert">
                <h1>Configuration Error</h1>
                <p>The API_KEY is not configured for the Gemini AI client. Please ensure it is set in the environment variables.</p>
            </div>
        );
    }

    return (
        <>
            <h1><span role="img" aria-label="Magnifying glass icon">🔍</span> MCQ Question Extractor</h1>
            
            <div 
                className={`input-area ${isDraggingOver ? 'drag-active' : ''}`}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                role="group"
                aria-labelledby="file-upload-instruction-text"
                aria-describedby="file-upload-description"
            >
                <p 
                    id="file-upload-instruction-text" 
                    className={`file-upload-instruction ${isDraggingOver ? 'drag-instruction-active' : ''}`}
                >
                    {isDraggingOver 
                        ? <><i className="fa-solid fa-cloud-arrow-down" aria-hidden="true"></i> Drop Image Here!</>
                        : "Select an image file (e.g., JPG, PNG) containing MCQs, or drag and drop it onto this area."}
                </p>
                <p id="file-upload-description" className="visually-hidden">
                    This area allows you to upload an image by clicking the 'Choose Image' button or by dragging and dropping an image file directly.
                </p>

                <div className="file-input-container">
                    <input
                        type="file"
                        id="image-upload"
                        accept="image/*"
                        onChange={handleFileChange}
                        aria-describedby="file-upload-instruction-text"
                        className="visually-hidden"
                    />
                    <label htmlFor="image-upload" className="custom-file-button">
                        <i className="fa-solid fa-upload" aria-hidden="true"></i> Choose Image
                    </label>
                    {selectedFile && <span className="selected-file-name">{selectedFile.name}</span>}
                </div>
                
                {previewUrl && (
                    <img src={previewUrl} alt="Preview of uploaded image" className="image-preview" />
                )}
            </div>

            {previewUrl && !error && ( // Only show extract button if there's a preview and no initial file error
                <>
                    <button onClick={handleExtract} disabled={!selectedFile || isLoading} aria-live="polite">
                        {isLoading ? (
                            <>
                                <span className="bouncing-dots-loader" aria-hidden="true">
                                    <span></span>
                                    <span></span>
                                    <span></span>
                                </span>
                                Extracting...
                            </>
                        ) : (
                            <>
                                <i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> Extract
                            </>
                        )}
                    </button>
                </>
            )}
            
            {/* Display error messages separately */}
            {error && <div className="status-message error" role="alert">{error}</div>}
            {isLoading && <div className="status-message loading" role="status">Processing image and extracting questions...</div>}


            {mcqData && mcqData.length > 0 && (
                <div className="result-area">
                    <h2>Extracted Results:</h2>
                    {mcqData.map((item, qIndex) => (
                        <div key={qIndex} className="extracted-mcq-item" aria-labelledby={`question-heading-${qIndex}`}>
                            <button 
                                className="copy-single-button" 
                                onClick={() => handleCopySingle(qIndex)}
                                aria-label={`Copy Question ${qIndex + 1}`}
                                title={`Copy Question ${qIndex + 1}`}
                            >
                                {copiedQuestionIndex === qIndex ? (
                                    <i className="fa-solid fa-check" aria-hidden="true"></i>
                                ) : (
                                    <i className="fa-solid fa-copy" aria-hidden="true"></i>
                                )}
                            </button>
                            <h3 id={`question-heading-${qIndex}`} className="question-header">Question {qIndex + 1}</h3>
                            <div className="extracted-content">
                                <p className="extracted-question">{item.question}</p>
                                <ul className="extracted-options">
                                    {item.options.map((option, oIndex) => (
                                        <li key={oIndex}>{String.fromCharCode(97 + oIndex)}. {option}</li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    ))}
                    <div className="button-group">
                        <button onClick={handleCopyAll} disabled={isLoading || mcqData.length === 0}>
                            <i className="fa-solid fa-copy" aria-hidden="true"></i> {copyButtonText}
                        </button>
                    </div>
                </div>
            )}
             {previewUrl && mcqData && mcqData.length === 0 && !isLoading && !error && ( // Ensure no error is shown alongside "no questions found"
                <div className="status-message info" role="status">No questions were found in the uploaded image.</div>
            )}
        </>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
