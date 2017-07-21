'use strict';

const express     = require('express')
const app         = express()
const bodyParser  = require('body-parser')
const request     = require('request')
const Translate   = require('@google-cloud/translate')
const https       = require('https')
const firebase    = require('firebase')
const admin       = require("firebase-admin")

const languageCodes = ['ar','hr','da','nl','en','fi','fr','de','el','hi','is','ga','it','ja','la','no','pl','pr','es','sv','th','cy']

app.use(bodyParser.json())

// ------------------------------------------------
// ----------------- Firebase ---------------------
// ------------------------------------------------
let config = {
  apiKey: process.env.FIREBASE_API_KEY || FIREBASE_API_KEY,
  authDomain: process.env.AUTH_DOMAIN || AUTH_DOMAIN,
  databaseURL: process.env.DATABASE_URL || DATABASE_URL,
  storageBucket: process.env.STORAGE_BUCKET || STORAGE_BUCKET,
  messagingSenderId: process.env.MESSAGING_SENDER_ID || MESSAGING_SENDER_ID
};
firebase.initializeApp(config);

// Add name if we can get that data from facebook later
function writeNewUserData(facebookBuddyId) {

  sendTextMessage(facebookBuddyId, 'Hey! To get started you will need to setup your account. First, set your native language by typing \n/language <language code> for example, /language en, for English 😎. To see a full list of supported languages type /languages. After you have done that, message me with /buddy.\nIf you ever get stuck type /help. \u{1F60B}');

  let url = 'https://graph.facebook.com/v2.6/'+facebookBuddyId+'?fields=first_name,last_name&access_token='+process.env.PAGE_ACCESS_TOKEN || PAGE_ACCESS_TOKEN,
      fname,
      sname;

  https.get(url, function(res){
      let body = '';

      res.on('data', function(chunk){
          body += chunk;
      });

      res.on('end', function(){
          let fbResponse = JSON.parse(body);
          fname = fbResponse.first_name
          sname = fbResponse.last_name
          firebase.database().ref('users/' + facebookBuddyId).set({
            facebookBuddyId: facebookBuddyId,
            fname: fname,
            sname: sname,
            lang: 'en',
            currency: 'false',
            time: 'false',
            unitOfMeasurement: 'false',
            buddy: 'null',
            bname: 'no one'
          });
      });
  }).on('error', function(e){
        console.log("Got an error: ", e);
  });
}



// ------------------------------------------------
// ------------- Google Translate -----------------
// ------------------------------------------------
'use strict';

// Instantiates a client
const translateClient = Translate({ projectId: 'tung-chatbot' });

  admin.initializeApp({
    credential: admin.credential.cert(process.env.GOOGLE_APPLICATION_CREDENTIALS || GOOGLE_APPLICATION_CREDENTIALS),
    databaseURL: "https://tung-chatbot.firebaseio.com"
  });

app.listen(process.env.PORT || 3000, function(){
  console.log("Express server listening on port %d in %s mode", this.address().port, app.settings.env);
});

app.get('/favicon.ico', function(req, res) {
    res.send(200);
});

// Verification
app.get('/webhook/', function(req, res) {
  if (req.query['hub.mode'] === 'subscribe' &&
    req.query['hub.verify_token'] === process.env.FACEBOOK_SECRET || FACEBOOK_SECRET) {
      res.status(200).send(req.query['hub.challenge']);
    } else {
      res.sendStatus(403);
    }
});

// Recieves messages
app.post('/webhook', function (req, res) {
  let data = req.body;

  // Make sure this is a page subscription
  if (data.object === 'page') {

    // Iterate over each entry - there may be multiple if batched
    data.entry.forEach(function(entry) {
      let pageID = entry.id;
      let timeOfEvent = entry.time;

      // Iterate over each messaging event
      entry.messaging.forEach(function(event) {
        if (event.message) {
          receivedMessage(event);
        } else {
          console.log("Webhook received unknown event: ", event);
        }
      });
    });
    res.sendStatus(200);
  }
});

function receivedMessage(event) {
  let senderId = event.sender.id,
      recipientID = event.recipient.id,
      timeOfMessage = event.timestamp,
      message = event.message,
      messageId = message.mid,
      messageText = message.text,
      messageAttachments = message.attachments,
      userRef = firebase.database().ref('users/');

  // If user does not exist then create new user
  userRef.once('value', function(snapshot) {
    if (!(snapshot.hasChild(senderId))) {
      writeNewUserData(senderId)
    }
  });

  // If we receive a text message, check to see if user is trying to execute a command
  if (messageText && messageText.substring(0,1) === "/") {
    commandHandler(event);
  } else if (messageAttachments) {
    sendTextMessage(senderId, "Message with attachment received");
  } else {
    // Default behaviour
    firebase.database().ref('users/' + senderId).once('value').then(function(snapshot) {
      let buddy = snapshot.val().buddy

      sendTranslatedMessage(senderId, buddy, messageText);
    });
  }
}

// Available commands
function commandHandler(event) {
  let command = event.message.text.substring(1),
      senderId = event.sender.id,
      commandKeyAndValue = command.split(" "),
      commandKey = commandKeyAndValue[0],
      commandValue = commandKeyAndValue[1],
      commandValueTwo = commandKeyAndValue[2];

  switch (commandKey) {
    case 'language':
        setLanguage(senderId, commandValue);
      break;
    case 'languages':
        languageList(senderId);
      break;
    case 'buddy':
        setBuddy(senderId, commandValue, commandValueTwo);
      break;
    case 'help':
        helpCommand(senderId)
      break;
    case 'time':
        updateUserTime(senderId, commandValue);
      break;
    case 'unit':
        updateUserUnit(senderId, commandValue);
      break;
    case 'currency':
        updateUserCurr(senderId, commandValue);
      break;
    default:
        sendTextMessage(senderId, 'I don\'t recognise that command. Type /help for the list of available commands.')
  }
}

function helpCommand(senderId){
  sendTextMessage(senderId, 'To chat with someone you must first choose your language and then link to a buddy.\nList of commands:\n/buddy\n/language\n/languages\nIn construction:\n/unit\n/time\n/currency')
}

function setLanguage(senderId, value){
  if (value === undefined) {
    firebase.database().ref('users/' + senderId).once('value').then(function(snapshot) {
      let currentLang = snapshot.val().lang;
        sendTextMessage(senderId, 'Your current language is set to '+currentLang+'. If you wish to change it, type /language <language code>. For example to change to English type /language en. For a list of all supported languages type /languages')
    });
  } else {
    updateUserLang(senderId, value);
  }
}

function languageList(senderId){
  sendTextMessage(senderId, 'list of available languages:\nArabic = ar\nCroatian = hr\nDanish = da\nDutch = nl\nEnglish = en\nFinnish = fi\nFrench = fr\nGerman = de\nGreek = el\nHindi = hi\nIcelandic = is\nIrish = ga\nItalian = it\nJapanese = ja\nLatin = la\nNorwegian = no\nPolish = pl\nPortuguese = pt\nSpanish = es\nSwedish = sv\nThai = th\nWelsh = cy\nFor more languages go to: https://cloud.google.com/translate/docs/languages')
}

function setBuddy(senderId, firstName, secondName){
  if (secondName === undefined && firstName === undefined) {
    firebase.database().ref('users/' + senderId).once('value').then(function(snapshot) {
      let currentBuddy = snapshot.val().bname;
        sendTextMessage(senderId, 'You are currently linked with '+currentBuddy+'. If you wish to add or change a buddy, type /buddy <buddy name>. For example /buddy David Attenborough.')
    });
  } else {
    updateUserBuddy(senderId, firstName, secondName);
  }
}
function updateUserLang(facebookBuddyId, lang) {
  if (languageCodes.indexOf(langCode) > -1){
    return firebase.database().ref('users/' + facebookBuddyId).update({
      lang: lang
    });
    sendTextMessage(facebookBuddyId, 'You set your language to '+lang+'.');
  } else {
    sendTextMessage(facebookBuddyId, "That language code either doesn't exist or was entered incorrectly. Type /languages to see a list of what's available")
  }
}

function updateUserCurr(facebookBuddyId, currency) {
  firebase.database().ref('users/' + facebookBuddyId).update({
    curr: curr
  });
}

function updateUserTime(facebookBuddyId, time) {
  firebase.database().ref('users/' + facebookBuddyId).update({
    time: time
  });
}

function updateUserUnit(facebookBuddyId, unitOfMeasurement) {
  firebase.database().ref('users/' + facebookBuddyId).update({
    unitOfMeasurement: unitOfMeasurement
  });
}

function updateUserBuddy(facebookBuddyId, firstName, secondName) {
  let query = firebase.database().ref('users/').orderByKey(),
      userExists = false;

  query.once('value')
    .then(function(snapshot) {
      snapshot.forEach(function(childSnapshot){

        let key = childSnapshot.key;

        let childData = childSnapshot.val(),
            childFacebookBuddyId = childSnapshot.val().facebookBuddyId,
            childFirstname = childSnapshot.val().fname,
            childSurname =childSnapshot.val().sname,
            childFullName = childFirstname + ' ' + childSurname,
            desiredName = firstName + ' ' + secondName;

            if (childFullName === desiredName){
              firebase.database().ref('users/' + facebookBuddyId).update({
                buddy: childFacebookBuddyId,
                bname: childFullName
              });

              userExists = true;

              sendTextMessage(facebookBuddyId, 'You are now linked with '+childFullName+'. Start chatting!');

              return true;
            }
      });
    if (userExists === false){
      sendTextMessage(facebookBuddyId, 'We couldn\'t find a buddy with that name. The buddy name should be the same as it appears on their Facebook, both first and second name.');
    }
  });
}

// sendTextMessage formats the data in the request
function sendTextMessage(recipientId, messageText) {
  let messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: messageText
    }
  };

  callSendAPI(messageData);
}

function sendTranslatedMessage(senderId, buddy, messageText) {

  firebase.database().ref('users/' + buddy).once('value').then(function(snapshot) {
    let language = snapshot.val().lang

    firebase.database().ref('users/' + senderId).once('value').then(function(snapshot) {
      let firstName = snapshot.val().fname

      translateClient.translate(messageText, language)
      .then((results) => {

        const translation = results[0];

        let messageData = {
          recipient: {
            id: buddy
          },
          message: {
            text: firstName+': '+translation
          }
        };
        callSendAPI(messageData);
      });
    });
  });
}

// callSendAPI calls the Send API
function callSendAPI(messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: process.env.PAGE_ACCESS_TOKEN || PAGE_ACCESS_TOKEN },
    method: 'POST',
    json: messageData

  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      let recipientId = body.recipient_id;
      let messageId = body.message_id;

      messageId, recipientId);
    } else {
      console.error("Unable to send message.");
    }
  });
}
