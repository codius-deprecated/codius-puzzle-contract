var bodyParser = require('body-parser');
var express = require('express');
var https = require('https');
var Remote = require('ripple-lib').Remote;
var Amount = require('ripple-lib').Amount;
var twilio = require('twilio');

if (!process.env.ADDRESS) {
  throw new Error('Must supply environment variables ADDRESS');
} else if (!process.env.SECRET) {
  throw new Error('Must supply environment variables SECRET');
} else if (!process.env.USD_ISSUER) {
  throw new Error('Must supply environment variables USD_ISSUER');
} else if (!process.env.TWILIO_ACCOUNT_SID) {
  throw new Error('Must supply environment variables TWILIO_ACCOUNT_SID');
} else if (!process.env.TWILIO_AUTH_TOKEN) {
  throw new Error('Must supply environment variables TWILIO_AUTH_TOKEN');
} else if (!process.env.XRP_REWARD) {
  throw new Error('Must supply environment variables XRP_REWARD');
} else if (!process.env.MAGIC_WORD) {
  throw new Error('Must supply environment variables MAGIC_WORD');
}

var remote = new Remote({
  trusted:        true,
  local_signing:  true,
  local_fee:      true,
  fee_cushion:     1.5,
  servers: [
    {
        host:    's1.ripple.com'
      , port:    443
      , secure:  true
    }
  ]
});

var app = express();
app.set('port', process.env.PORT || 8000);
app.use(bodyParser.urlencoded());

var twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

var RIPPLE_NAME_REGEX = /^~\w[\w.-]+\w$/;
var MAGIC_WORD_REGEX = '/' + process.env.MAGIC_WORD + '/i';
var rewardPaid = false;
var winner = null;

// Send XRP to recipient.
function sendReward(recipient) {
  if (typeof usd_to_send !== 'string') {
    usd_to_send = usd_to_send.toString();
  }

  var amount = process.env.XRP_REWARD;
  if (typeof amount === 'string') {
    amount = parseFloat(amount);
  }
  amount = process.env.XRP_REWARD * 1000000;  //convert to drops

  var tx = remote.transaction();

  tx.payment(process.env.ADDRESS, recipient, amount);

  tx.submit(function(err, result) {
    if (err) {
      console.log(err);
      console.log(tx)
    } else {
      console.log('Successfully sent ' + process.env.XRP_REWARD + ' XRP to ' + recipient);
    }
  });
};

// Receive SMS notifications from Twilio
// https://www.twilio.com/user/account/phone-numbers/incoming
app.post('/sms', function(req, res) {

  //TODO: Verify that this message is from Twilio

  var incomingMessage = req.body;
  console.log(incomingMessage.From + ' got message: "' + incomingMessage.Body + '" from: ' + incomingMessage.From );

  if (winner!==null && winner===incomingMessage.From) {
    if (rewardPaid) {
      sendTwilioResponse(res, 'Your reward has been sent. Check your Ripple account.');
      return;
    }
    var matchedRippleNames = incomingMessage.Body.match(RIPPLE_NAME_REGEX);
    var nameToReward;
    if (!matchedRippleNames || typeof matchedRippleNames[0] !== 'string') {
      sendTwilioResponse(res, 'You need to send your Ripple Name with the "~" in front to receive your reward.');
      return;
    }
    nameToReward = matchedRippleNames[0].slice(1); //remove the '~'
    https.get('https://id.ripple.com/v1/user/'+nameToReward, function(res) {
      console.log("statusCode: ", res.statusCode);
      console.log("headers: ", res.headers);

      res.on('data', function(d) {
        console.log(d);
        if (d.address) {
          if (rewardPaid) {
            sendTwilioResponse(res, 'Check your Ripple account.');
          } else {
            rewardPaid = true;
            sendReward(d.address);
          }
        } else {
          sendTwilioResponse(res, 'That Ripple name does not exist!');
        }
      });
    }).on('error', function(e) {
      console.error(e);
    });
  } else {
    if (-1===incomingMessage.Body.search(process.env.MAGIC_WORD)) {
      sendTwilioResponse(res, 'Too many secrets');
      return;
    } 
    if (winner===null) {
      winner = incomingMessage.From;
      sendTwilioResponse(res, 'Congratulations! You solved the puzzle. Send your Ripple Name with the "~" in front to receive your reward.');
    } else {
      sendTwilioResponse(res, 'Congratulations! You solved the puzzle. Unfortunately someone else beat you to it. Thanks for playing!');
    }
  }
});

function sendTwilioResponse(res, message) {
  var twiml = new twilio.TwimlResponse();
  twiml.message(message);
  res.set('Content-Type', 'text/xml');
  res.status(200);
  res.send(twiml.toString());
};

remote.connect(function() {
  console.log('remote connected');

  remote.set_secret(process.env.ADDRESS, process.env.SECRET);

  app.listen(app.get('port'), function(){
    console.log('listening');
  });
});