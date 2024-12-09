import express from 'express';
import bodyParser from 'body-parser';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import formidable from 'formidable';

dotenv.config();

const app = express();
const port = 3000;

app.use(bodyParser.json());
app.use(express.static('public'));

const openai = new OpenAI({
  apiKey: process.env.Qisra_API_KEY,
  defaultHeaders: {
    'OpenAI-Beta': 'assistants=v2',
  },
});

const assistantId = 'asst_tCaAT4tvJLABDCjvPuipscCb';
const vectorStoreId = 'vs_5xAGGwnAofsT3cBRGy6TsRJB';
let threadId = null;
let customSystemMessage = null;
let customFileUploaded = false;

// Initialize a new conversation thread
async function initializeThread(userMessage) {
  try {
    console.log("Initializing thread with parameters:");
    console.log("assistant_id:", assistantId);
    console.log("userMessage:", userMessage);
    
    const threadOptions = {
      assistant_id: assistantId,
      thread: {
        messages: [{ role: "user", content: userMessage }],
      },
    };

    // Only add tool resources or custom instructions if set by admin
    if (customFileUploaded || customSystemMessage) {
      threadOptions.tools = [{ type: "file_search" }];
      threadOptions.tool_resources = {
        file_search: { vector_store_ids: [vectorStoreId] },
      };
    }
    if (customSystemMessage) {
      threadOptions.instructions = customSystemMessage;
    }

    const threadResponse = await openai.beta.threads.createAndRun(threadOptions);

    threadId = threadResponse.thread_id;
    console.log("Initialized thread with ID:", threadId, "and run ID:", threadResponse.id);
    return threadResponse;
  } catch (error) {
    console.error("Error initializing thread:", error.response?.data || error.message);
  }
}

// Add message to an existing thread and retrieve assistant's response
async function createRunInThread(userMessage) {
  try {
    console.log("Creating run with parameters:");
    console.log("thread_id:", threadId);
    console.log("assistant_id:", assistantId);
    console.log("userMessage:", userMessage);

    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: userMessage,
    });

    const runOptions = {
      assistant_id: assistantId,
      include: [],
    };

    // Only add tool resources if a custom file has been uploaded
    if (customFileUploaded) {
      runOptions.tool_resources = {
        file_search: { vector_store_ids: [vectorStoreId] },
      };
    }

    const runResponse = await openai.beta.threads.runs.create(threadId, runOptions);

    const runId = runResponse.id;
    console.log("Started a new run with ID:", runId, "in thread:", threadId);

    const assistantMessage = await retrieveRunResponse(threadId, runId);
    await listRunSteps(threadId, runId, { include: [] });

    return assistantMessage;
  } catch (error) {
    console.error("Error creating run in thread:", error.response?.data || error.message);
    return "Error creating run in thread.";
  }
}

async function retrieveRunResponse(threadId, runId) {
  try {
    console.log("Retrieving run response with parameters:");
    console.log("thread_id:", threadId);
    console.log("run_id:", runId);

    let runStatus = 'in_progress';
    let retryAttempts = 0;
    let assistantMessage = 'No response content';

    while (runStatus === 'in_progress' && retryAttempts < 5) {
      const runResponse = await openai.beta.threads.runs.retrieve(threadId, runId);
      runStatus = runResponse.status;
      console.log("Retrieved run status:", runStatus);

      if (runStatus === 'completed') {
        const messagesResponse = await openai.beta.threads.messages.list(threadId);
        assistantMessage = messagesResponse.data.find(
          (msg) => msg.role === 'assistant'
        )?.content[0]?.text?.value || "No response content";
        break;
      }
      await new Promise((res) => setTimeout(res, 2000));
      retryAttempts++;
    }
    return assistantMessage;
  } catch (error) {
    console.error("Error retrieving run response:", error.response?.data || error.message);
    return "Error retrieving run response.";
  }
}

// List run steps
async function listRunSteps(threadId, runId, params = {}) {
  try {
    console.log("Listing run steps with parameters:");
    console.log("thread_id:", threadId);
    console.log("run_id:", runId);

    const { include = [] } = params;
    const stepsResponse = await openai.beta.threads.runs.steps.list(threadId, runId, { include });
    console.log("Run steps:", JSON.stringify(stepsResponse.data, null, 2));
  } catch (error) {
    console.error("Error listing run steps:", error.response?.data || error.message);
  }
}

// Route to handle user messages
app.post('/api/user-response', async (req, res) => {
  const userMessage = req.body.message;
  console.log("Received user message:", userMessage);

  try {
    let assistantMessage;
    if (!threadId) {
      const initResponse = await initializeThread(userMessage);
      assistantMessage = await retrieveRunResponse(initResponse.thread_id, initResponse.id);
    } else {
      assistantMessage = await createRunInThread(userMessage);
    }

    res.json({ response: assistantMessage });
  } catch (error) {
    console.error("Error in processing user response:", error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to communicate with OpenAI Assistant API' });
  }
});

// Admin Route to create a new thread
app.post('/api/admin/create-thread', async (req, res) => {
  try {
    threadId = null; 
    res.json({ message: "New thread created successfully." });
  } catch (error) {
    console.error("Error creating new thread:", error.message);
    res.status(500).json({ error: "Failed to create a new thread." });
  }
});

// Admin Route to modify assistant's system message
app.post('/api/admin/modify-system-message', async (req, res) => {
  const { systemMessage } = req.body;
  try {
    customSystemMessage = systemMessage;
    res.json({ message: "System message updated successfully." });
  } catch (error) {
    console.error("Error updating system message:", error.message);
    res.status(500).json({ error: "Failed to update system message." });
  }
});

// Admin Route to upload a new quiz or test file
app.post('/api/admin/upload-file', (req, res) => {
  const form = new formidable.IncomingForm();
  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error("Error parsing file upload:", err.message);
      res.status(500).json({ error: "Failed to upload file." });
      return;
    }
    const filePath = files.file.path;

    try {
      const fileUploadResponse = await openai.files.create({
        purpose: 'answers',
        file: filePath,
      });

      console.log("File uploaded successfully:", fileUploadResponse);

      await openai.beta.vectorStores.files.create(vectorStoreId, {
        file_id: fileUploadResponse.id,
      });

      customFileUploaded = true;
      res.json({ message: "File uploaded successfully and added to vector store." });
    } catch (error) {
      console.error("Error uploading file:", error.message);
      res.status(500).json({ error: "Failed to upload file." });
    }
  });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
