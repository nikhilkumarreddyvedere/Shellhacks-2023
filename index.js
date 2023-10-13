const express = require('express');
const { SpeechClient } = require('@google-cloud/speech');
const { TranslationServiceClient } = require('@google-cloud/translate');
const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffmpeg = require('fluent-ffmpeg');
const ytdl = require('ytdl-core');
const { exec } = require('child_process');
const util = require('util');



ffmpeg.setFfmpegPath(ffmpegPath);

const fs = require('fs');

const app = express();
const port = 8000;


app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Enable parsing of URL-encoded data

// Enable CORS for all routes
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // You can specify the allowed origins here
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  next();
});




// Initialize the Speech-to-Text client
const speechClient = new SpeechClient({
  keyFilename: 'key.json', // Replace with your Speech-to-Text service account key file
});

// Initialize the Translation client
const translationClient = new TranslationServiceClient({
  keyFilename: 'key.json', // Replace with your Translation API service account key file
});

// Initialize the Text-to-Speech client
const textToSpeechClient = new TextToSpeechClient({
  keyFilename: 'key.json', // Replace with your Text-to-Speech service account key file
});


app.post('/extractaudio', async (req, res) => {
  try {

    await deleteFileIfExists('videoOutput.mp4');
    await deleteFileIfExists('output.mp3');
    await deleteFileIfExists('audioOutput.mp3');
    await deleteFileIfExists('videoWithoutAudio.mp4');
    await deleteFileIfExists('translatedVideo.mp4');

    // Get the YouTube video URL from the request body
    const { youtubeUrl } = req.body;

    if (!youtubeUrl) {
      return res.status(400).json({ error: 'Missing YouTube video URL in the request body' });
    }

    // Generate a unique output MP4 file name
    const uniqueFileName = `videoOutput.mp4`;
    const mp4FilePath = uniqueFileName;
    const outputFilePath = `audioOutput.mp3`;
    const videoOutputFile = "videoWithoutAudio.mp4"

    // Download the video using ytdl
    const videoStream = ytdl(youtubeUrl, { quality: 'highest' });


    videoStream.pipe(fs.createWriteStream(mp4FilePath));
    videoStream.on('end', async () => {
      const videoStream1 = ytdl(youtubeUrl, { filter: 'audioonly' });
      const outputStream = fs.createWriteStream(outputFilePath);
      videoStream1.pipe(outputStream);
    })
    const ffmpegCommand = `ffmpeg -i ${mp4FilePath} -c:v copy -an ${videoOutputFile}`;
  exec(ffmpegCommand, (error, stdout, stderr) => {
      if (error) {
        console.error('Error removing audio:', error);
        res.status(500).json({ error: 'An error occurred while removing audio' });
      } else {
        console.log('Audio removal complete.');
        res.status(200).json({ message:"Successfully Extracted Audio" });
      }
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'An error occurred' });
  }
});





app.post('/transcribeaudio', async (req, res) => {
  try {
    const fileName = 'audioOutput.mp3';
    const mp3Data = fs.readFileSync(fileName);

    const audio = {
      content: mp3Data.toString('base64'),
    };

    const { sourceLanguage, targetLanguage, genderVoice } = req.body; // Get source and target languages from query parameters


    console.log('the values are', req.body)

    const config = {
      encoding: 'MP3',
      sampleRateHertz: 44100,
      enableAutomaticPunctuation: true,
      languageCode: sourceLanguage || 'en',
    };

    const [response] = await speechClient.recognize({ config, audio });
    const transcription = response.results
      .map(result => result.alternatives[0].transcript)
      .join('\n');

    // Pass the transcription to the translation method
    const translatedText = await translateText(transcription,sourceLanguage, targetLanguage); // Translate to English

    // Pass the translated text to the textToSpeech method
    const audioBuffer = await textToSpeech(translatedText, targetLanguage, genderVoice);

    // Save the audio to an MP3 file
    const outputFileName = 'output.mp3';
    fs.writeFileSync(outputFileName, audioBuffer);

    res.status(200).json({ transcription, translatedText, audioBuffer });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'An error occurred' });
  }
});

// Translation function
async function translateText(text, sourceLanguage, targetLanguage) {
  const [translation] = await translationClient.translateText({
    parent: `projects/protean-bit-399205`, // Replace with your Google Cloud project ID
    contents: [text],
    mimeType: 'text/plain',
    sourceLanguageCode: sourceLanguage, // Source language (Spanish)
    targetLanguageCode: targetLanguage, // Target language
  });

  return translation.translations[0].translatedText;
}

// Text-to-Speech function
async function textToSpeech(text, targetLanguage, genderVoice) {
  const request = {
    input: { text },
    voice: { languageCode: targetLanguage, ssmlGender: genderVoice }, // You can adjust the voice settings
    audioConfig: { audioEncoding: 'MP3' },
  };

  const [response] = await textToSpeechClient.synthesizeSpeech(request);
  return response.audioContent;
}


app.post('/addaudio', async (req, res) => {
  try {
    mp4FilePath = "videoWithoutAudio.mp4"
    audioFilePath = "output.mp3"
    outputFilePath = "translatedVideo.mp4"
    const ffmpegCommand = `ffmpeg -i ${mp4FilePath} -i ${audioFilePath} -c:v copy -c:a aac -strict experimental ${outputFilePath}`;
    exec(ffmpegCommand, (error, stdout, stderr) => {
      if (error) {
        console.error('Error adding audio:', error);
        res.status(500).json({ error: 'An error occurred while adding audio' });
      } else {
        console.log('Audio added successfully to the video.');

        // Send a success message with the video containing audio
        res.status(200).json({ message: 'Audio added successfully', mp4FilePath: outputFilePath });
      }
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'An error occurred during audio addition' });
  }
});


// Function to delete a file if it exists
const deleteFileIfExists = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Deleted existing file: ${filePath}`);
    }
  } catch (error) {
    console.log(`Error deleting file ${filePath}`);
  }
};


app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
