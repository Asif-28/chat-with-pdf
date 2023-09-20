// 1. Import necessary modules and libraries
import { OpenAI } from "langchain/llms/openai";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import * as dotenv from "dotenv";
import { NextRequest, NextResponse } from "next/server";
import { PineconeClient } from "@pinecone-database/pinecone";
import { DirectoryLoader } from "langchain/document_loaders/fs/directory";
import { PDFLoader } from "langchain/document_loaders/fs/pdf";
import { loadQAStuffChain } from "langchain/chains";
import { Document } from "langchain/document";
dotenv.config();

// Define the main function
export const GET = async (req: NextRequest, res: NextResponse) => {
  try {
    const loader = new DirectoryLoader("./src/documents", {
      ".pdf": (path) => new PDFLoader(path),
    });
    const docs = await loader.load();
    const question = "summarize the document for me";
    const indexName = "your-pinecone-index-name";
    const vectorDimension = 1536;

    const client = new PineconeClient();
    await client.init({
      apiKey: process.env.PINECONE_API_KEY,
      environment: process.env.PINECONE_ENVIRONMENT,
    });

    const createPineconeIndex = async (
      client: any,
      indexName: any,
      vectorDimension: any
    ) => {
      // Initiate index existence check
      console.log(`Checking "${indexName}"...`);
      // Get list of existing indexes
      const existingIndexes = await client.listIndexes();
      // If index doesn't exist, create it
      if (!existingIndexes.includes(indexName)) {
        // Log index creation initiation
        console.log(`Creating "${indexName}"...`);
        // Create index
        const createClient = await client.createIndex({
          createRequest: {
            name: indexName,
            dimension: vectorDimension,
            metric: "cosine",
          },
        });
        // Log successful creation
        console.log(`Created with client:`, createClient);
        // Wait 60 seconds for index initialization
        await new Promise((resolve) => setTimeout(resolve, 60000));
      } else {
        // Log if index already exists
        console.log(`"${indexName}" already exists.`);
      }
    };
    await createPineconeIndex(client, indexName, vectorDimension);
    // Update Pinecone vector store with document embeddings
    await updatePinecone(client, indexName, docs);
    // Query Pinecone vector store and GPT model for an answer
    const result = await queryPineconeVectorStoreAndQueryLLM(
      client,
      indexName,
      question
    );
    return NextResponse.json({ message: `${result}`, statues: "200" });
  } catch (error: any) {
    if (error.response && error.response.status === 429) {
      console.error("Rate limit exceeded. Please wait and try again later.");
    } else {
      console.error("An error occurred:", error.message);
    }
  }
};
const updatePinecone = async (client: any, indexName: any, docs: any) => {
  console.log("Retrieving Pinecone index...");
  //Retrieve Pinecone index
  const index = client.Index(indexName);
  // Log the retrieved index name
  console.log(`Pinecone index retrieved: ${indexName}`);
  //  Process each document in the docs array
  for (const doc of docs) {
    console.log(`Processing document: ${doc.metadata.source}`);
    const txtPath = doc.metadata.source;
    const text = doc.pageContent;
    //  Create RecursiveCharacterTextSplitter instance
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
    });
    console.log("Splitting text into chunks...");
    // Split text into chunks (documents)
    const chunks = await textSplitter.createDocuments([text]);
    console.log(`Text split into ${chunks.length} chunks`);
    console.log(
      `Calling OpenAI's Embedding endpoint documents with ${chunks.length} text chunks ...`
    );
    // Create OpenAI embeddings for documents
    const embeddingsArrays = await new OpenAIEmbeddings().embedDocuments(
      chunks.map((chunk) => chunk.pageContent.replace(/\n/g, " "))
    );
    console.log("Finished embedding documents");
    console.log(
      `Creating ${chunks.length} vectors array with id, values, and metadata...`
    );
    // Create and upsert vectors in batches of 100
    const batchSize = 100;
    let batch = [];
    for (let idx = 0; idx < chunks.length; idx++) {
      const chunk = chunks[idx];
      const vector = {
        id: `${txtPath}_${idx}`,
        values: embeddingsArrays[idx],
        metadata: {
          ...chunk.metadata,
          loc: JSON.stringify(chunk.metadata.loc),
          pageContent: chunk.pageContent,
          txtPath: txtPath,
        },
      };
      batch.push(vector);
      // When batch is full or it's the last item, upsert the vectors
      if (batch.length === batchSize || idx === chunks.length - 1) {
        await index.upsert({
          upsertRequest: {
            vectors: batch,
          },
        });
        // Empty the batch
        batch = [];
      }
    }
    // Log the number of vectors updated
    console.log(`Pinecone index updated with ${chunks.length} vectors`);
  }
};

const queryPineconeVectorStoreAndQueryLLM = async (
  client: any,
  indexName: any,
  question: any
) => {
  // Start query process
  console.log("Querying Pinecone vector store...");
  // Retrieve the Pinecone index
  const index = client.Index(indexName);
  // Create query embedding
  const queryEmbedding = await new OpenAIEmbeddings().embedQuery(question);
  // Query Pinecone index and return top 10 matches
  let queryResponse = await index.query({
    queryRequest: {
      topK: 10,
      vector: queryEmbedding,
      includeMetadata: true,
      includeValues: true,
    },
  });
  // Log the number of matches
  console.log(`Found ${queryResponse.matches.length} matches...`);
  // Log the question being asked
  console.log(`Asking question: ${question}...`);
  if (queryResponse.matches.length) {
    // Create an OpenAI instance and load the QAStuffChain
    const llm = new OpenAI({});
    const chain = loadQAStuffChain(llm);
    // Extract and concatenate page content from matched documents
    const concatenatedPageContent = queryResponse.matches
      .map((match: any) => match.metadata.pageContent)
      .join(" ");
    // Execute the chain with input documents and question
    const result = await chain.call({
      input_documents: [new Document({ pageContent: concatenatedPageContent })],
      question: question,
    });
    // Log the answer and return the result
    console.log(`Answer: ${result.text}`);
    return result.text;
  } else {
    //Log that there are no matches, so GPT-3 will not be queried
    console.log("There are no matches");
  }
};
