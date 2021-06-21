/**
 * solace-client.js
 * @author Andrew Roberts
 */

import solace from "solclientjs";

/**
 * A factory function that returns a solclientjs session wrapper.
 * If hostUrl or options are not provided, the client will attempt to
 * connect using Solace PubSub+ friendly defaults.
 * @param {object} options
 */
export function createSolaceClient({
  // assign defaults if the values aren't included in the provided object,
  url = "tcp://localhost:55555",
  vpnName = "default",
  userName = "default",
  password = "",
}) {
  /**
   * initialize solclientjs
   */
  let factoryProps = new solace.SolclientFactoryProperties();
  factoryProps.profile = solace.SolclientFactoryProfiles.version10;
  solace.SolclientFactory.init(factoryProps);

  /**
   * Private reference to the client connection object
   */
  let session = null;

  /**
   * Private map between topic subscriptions and their associated handler callbacks.
   * Messages are dispatched to all topic subscriptions that match the incoming message's topic.
   * subscribe and unsubscribe modify this object.
   */
  let subscriptions = {};

  /**
   * Private reference to queue consumer object
   */
  let queueConsumer = {
    consuming: false,
    ref: null,
  };

  /**
   * event handlers
   *
   * solclientjs exposes session lifecycle events, or callbacks related to the session with the broker.
   * The methods below are sensible defaults, and can be modified using the exposed setters.
   * Source documentation here:
   */

  let onUpNotice = (sessionEvent) => {
    logInfo(`Connected`);
  };

  let onConnectFailedError = (sessionEvent) => {
    logError(sessionEvent);
  };

  let onDisconnected = (sessionEvent) => {
    logInfo(`Disconnected`);
  };

  // onMessage handler configured to dispatch incoming messages to
  // the associated handlers of all matching topic subscriptions.
  const onMessage = (message) => {
    const topic = message.getDestination().getName();
    for (const topicSubscription of Object.keys(subscriptions)) {
      if (topicMatchesTopicFilter(topicSubscription, topic)) {
        subscriptions[topicSubscription]?.handler(message);
      }
    }
  };

  /**
   * event handler setters
   */

  function setOnUpNotice(_onUpNotice) {
    onUpNotice = _onUpNotice;
  }

  function setOnConnectFailedError(_onConnectFailedError) {
    onConnectFailedError = _onConnectFailedError;
  }

  function setOnDisconnected(_onDisconnected) {
    onDisconnected = _onDisconnected;
  }

  /**
   * Overloaded solclientjs connect method.
   * Resolves with a solclientjs session wrapper object if UP_NOTICE ,
   * rejects if there is an error while connecting.
   *
   *  Solace docs:  https://docs.solace.com/API-Developer-Online-Ref-Documentation/js/solace.Session.html#connect
   */
  async function connect() {
    return new Promise((resolve, reject) => {
      // guard: if session is already connected, do not try to connect again.
      if (session !== null) {
        logError("Error from connect(), already connected.");
        reject();
      }
      // guard: check url protocol
      if (url.indexOf("tcp") != 0) {
        reject("HostUrl must be the WebMessaging Endpoint that begins with either tcp:// or tcps://.");
      }
      // initialize session
      try {
        session = solace.SolclientFactory.createSession({
          url,
          vpnName,
          userName,
          password,
          connectRetries: 3,
          publisherProperties: {
            acknowledgeMode: solace.MessagePublisherAcknowledgeMode.PER_MESSAGE,
          },
        });
      } catch (error) {
        logError(error);
        reject();
      }

      /**
       * configure session event listeners
       */

      // UP_NOTICE fires when the session is connected
      session.on(solace.SessionEventCode.UP_NOTICE, (sessionEvent) => {
        onUpNotice();
        resolve({
          // extend base session object w/ overloaded methods and utils
          disconnect,
          publish,
          subscribe,
          unsubscribe,
          unsubscribeAll,
          logInfo,
          logError,
        });
      });

      // CONNECT_FAILED_ERROR fires on connection failure
      session.on(solace.SessionEventCode.CONNECT_FAILED_ERROR, (sessionEvent) => {
        onConnectFailedError(sessionEvent);
        reject();
      });

      // DISCONNECTED fires if the session is disconnected
      session.on(solace.SessionEventCode.DISCONNECTED, (sessionEvent) => {
        onDisconnected();
        if (session !== null) {
          session.dispose();
          //subscribed = false;
          session = null;
        }
      });

      // ACKNOWLEDGED MESSAGE fires when the broker sends this session a message received receipt
      session.on(solace.SessionEventCode.ACKNOWLEDGED_MESSAGE, (sessionEvent) => {
        // logInfo("Delivery of message with correlation key = " + sessionEvent.correlationKey + " confirmed.");
      });

      // REJECTED_MESSAGE fires if the broker sends this session a rejected message receipt
      session.on(solace.SessionEventCode.REJECTED_MESSAGE_ERROR, (sessionEvent) => {
        logError(
          "Delivery of message with correlation key = " +
            sessionEvent.correlationKey +
            " rejected, info: " +
            sessionEvent.infoStr
        );
      });

      // SUBSCRIPTION ERROR fires if there's been an error while subscribing on a topic
      session.on(solace.SessionEventCode.SUBSCRIPTION_ERROR, (sessionEvent) => {
        logError(`Cannot subscribe to topic "${sessionEvent.correlationKey}"`);
        // remove subscription
        delete subscription[sessionEvent.correlationKey];
      });

      // SUBSCRIPTION_OK fires when a subscription was succesfully applied/removed from the broker
      session.on(solace.SessionEventCode.SUBSCRIPTION_OK, (sessionEvent) => {});

      // MESSAGE fires when this session receives a message
      session.on(solace.SessionEventCode.MESSAGE, onMessage);

      // connect the session
      try {
        session.connect();
      } catch (error) {
        logError(error);
      }
    });
  }

  /**
   * Overloaded solclientjs createMessageConsumer method.
   * Resolves with a solclientjs session wrapper object if UP_NOTICE ,
   * rejects if there is an error while connecting.
   *
   *  Solace docs:  https://docs.solace.com/API-Developer-Online-Ref-Documentation/js/solace.Session.html#createMessageConsumer
   */
  async function connectMessageConsumer(queueName) {
    return new Promise((resolve, reject) => {
      // guard: if session is already connected, do not try to connect again.
      if (session !== null) {
        logError("Error from connectMessageConsumer(), already connected.");
        reject();
      }
      // guard: check url protocol
      if (url.indexOf("tcp") != 0) {
        logError("HostUrl must be the WebMessaging Endpoint that begins with either tcp:// or tcps://.");
        reject("HostUrl must be the WebMessaging Endpoint that begins with either tcp:// or tcps://.");
      }
      // initialize session
      try {
        session = solace.SolclientFactory.createSession({
          url,
          vpnName,
          userName,
          password,
          connectRetries: 3,
          publisherProperties: {
            acknowledgeMode: solace.MessagePublisherAcknowledgeMode.PER_MESSAGE,
          },
        });
      } catch (error) {
        logError(error);
        reject();
      }

      /**
       * configure session event listeners
       */

      // UP_NOTICE fires when the session is connected
      session.on(solace.SessionEventCode.UP_NOTICE, (sessionEvent) => {
        onUpNotice();
        resolve();
      });

      // CONNECT_FAILED_ERROR fires on connection failure
      session.on(solace.SessionEventCode.CONNECT_FAILED_ERROR, (sessionEvent) => {
        onConnectFailedError(sessionEvent);
        reject();
      });

      // DISCONNECTED fires if the session is disconnected
      session.on(solace.SessionEventCode.DISCONNECTED, (sessionEvent) => {
        onDisconnected();
        queueConsumer.consuming = false;
        if (session !== null) {
          session.dispose();
          session = null;
        }
      });

      // connect the session
      try {
        session.connect();
      } catch (error) {
        logError(error);
        reject();
      }

      queueConsumer.ref = session.createMessageConsumer({
        // solace.MessageConsumerProperties
        queueDescriptor: { name: queueName, type: solace.QueueType.QUEUE },
        acknowledgeMode: solace.MessageConsumerAcknowledgeMode.CLIENT, // Enabling Client ack
      });

      // Define message consumer event listeners
      queueConsumer.ref.on(solace.MessageConsumerEventName.UP, function () {
        queueConsumer.consuming = true;
        logInfo("=== Ready to receive messages. ===");
      });

      queueConsumer.ref.on(solace.MessageConsumerEventName.CONNECT_FAILED_ERROR, function () {
        queueConsumer.consuming = false;
        logError(
          '=== Error: the message consumer could not bind to queue "' +
            queueName +
            '" ===\n   Ensure this queue exists on the message router vpn'
        );
      });

      queueConsumer.ref.on(solace.MessageConsumerEventName.DOWN, function () {
        queueConsumer.consuming = false;
        logError("=== The message consumer is now down ===");
      });

      queueConsumer.ref.on(solace.MessageConsumerEventName.DOWN_ERROR, function () {
        queueConsumer.consuming = false;
        logError("=== An error happened, the message consumer is down ===");
      });

      // Define message received event listener
      queueConsumer.ref.on(solace.MessageConsumerEventName.MESSAGE, async function (message) {
        queueConsumer.ref.stop();
        // await sleep(1000);
        let deserializedMessage = parse(message);
        let validatedMessage = { ...deserializedMessage, validationStatus: true };
        publish(
          `retailco/order/update/validated/v1/${validatedMessage.channel}/${validatedMessage.type}`,
          JSON.stringify(validatedMessage)
        );
        // Need to explicitly ack otherwise it will not be deleted from the message router
        message.acknowledge();
        queueConsumer.ref.start();
      });

      // connect the session
      try {
        queueConsumer.ref.connect();
      } catch (error) {
        logError(error);
        reject();
      }
    });
  }

  function disconnect() {
    if (session !== null) {
      try {
        session.disconnect();
      } catch (error) {
        logError(error);
      }
    }
  }

  /**
   * Overloaded solclientjs subscribe method.
   * Extends default subscribe behavior by accepting a handler argument
   * that is called with any incoming messages that match the topic subscription.
   * https://docs.solace.com/API-Developer-Online-Ref-Documentation/js/solace.Session.html#subscribe
   * @param {string} topic
   * @param {any} handler
   */
  function publish(topic, payload) {
    // Check if the session has been established
    if (!session) {
      logError("Error from subscribe(), session not connected.");
      return;
    }
    // form message object
    let message = solace.SolclientFactory.createMessage();
    message.setDestination(solace.SolclientFactory.createTopicDestination(topic));
    message.setBinaryAttachment(payload);
    message.setDeliveryMode(solace.MessageDeliveryModeType.PERSISTENT);
    // publish message
    try {
      session.send(message);
    } catch (error) {
      logError(error);
    }
  }

  /**
   * Overloaded solclientjs subscribe method.
   * Extends default subscribe behavior by accepting a handler argument
   * that is called with any incoming messages that match the topic subscription.
   * https://docs.solace.com/API-Developer-Online-Ref-Documentation/js/solace.Session.html#subscribe
   * @param {string} topic
   * @param {any} handler
   */
  function subscribe(topic, handler) {
    // Check if the session has been established
    if (!session) {
      logError("Error from subscribe(), session not connected.");
      return;
    }
    // Check if the subscription already exists
    if (subscriptions[topic]) {
      logError(`Error from subscribe(), already subscribed to "${topic}"`);
      return;
    }
    // associate event handler with topic filter on client
    subscriptions[topic] = { handler, isSubscribed: false };
    // subscribe session to topic
    try {
      session.subscribe(
        solace.SolclientFactory.createTopicDestination(topic),
        true, // generate confirmation when subscription is added successfully
        topic, // use topic name as correlation key
        10000 // 10 seconds timeout for this operation
      );
    } catch (error) {
      logError(error);
    }
  }

  /**
   * @param {string} topic
   */
  function unsubscribe(topic) {
    // guard: do not try to unsubscribe if session has not yet been connected
    if (!session) {
      logError(`Error unsubscribing, session is not connected`);
      return;
    }
    // remove event handler
    delete subscriptions[topic];
    // unsubscribe session from topic filter
    session.unsubscribe(solace.SolclientFactory.createTopicDestination(topic), true, topic);
  }

  /**
   * Unsubscribes the client from all its topic subscriptions
   */
  function unsubscribeAll() {
    // guard: do not try to unsubscribe if client has not yet been connected
    if (!session) {
      logError(`Error from unsubscribeAll(), session not connected`);
      reject();
    }
    // unsubscribe from all topics on client
    Object.keys(subscriptions).map((topicFilter, _) => unsubscribe(topicFilter));
  }

  /**
   * info level logger
   * @param {string} message
   */
  function logInfo(message) {
    const log = {
      userName,
      time: new Date().toISOString(),
      msg: message,
    };
    console.log(JSON.stringify(log));
  }

  /**
   * error level logger
   * @param {string} message
   */
  function logError(error) {
    const errorLog = {
      userName,
      time: new Date().toISOString(),
      error: error,
    };
    console.error(JSON.stringify(errorLog));
  }

  /**
   * This factory function returns an object that only exposes methods to configure and connect the client.
   * Methods to add subscriptions (and all others) are exposed in the client the connect method resolves with.
   */
  return {
    connect,
    connectMessageConsumer,
    setOnUpNotice,
    setOnConnectFailedError,
    setOnDisconnected,
    logInfo,
    logError,
  };
}

/**
 * Return a boolean indicating whether the topic filter the topic.
 * @param {string} topicFilter
 * @param {string} topic
 */
export function topicMatchesTopicFilter(topicFilter, topic) {
  // convert topic filter to a regex and see if the incoming topic matches it
  let topicFilterRegex = convertSolaceTopicFilterToRegex(topicFilter);
  let match = topic.match(topicFilterRegex);

  // if the match index starts at 0, the topic matches the topic filter
  if (match && match.index == 0) {
    // guard: check edge case where the pattern is a match but the last character is *
    if (topicFilterRegex.lastIndexOf("*") == topic.length - 1) {
      // if the number of topic sections are not equal, the match is a false positive
      if (topicFilterRegex.split("/").length != topic.split("/").length) {
        return false;
      }
    }
    // if no edge case guards return early, the match is genuine
    return true;
  }

  // else the match object is empty, and the topic is not a match with the topic filter
  else {
    return false;
  }
}

/**
 * Convert Solace topic filter wildcards and system symbols into regex
 * Useful resource for learning: https://regexr.com/
 * @param {string} topicFilter
 */
export function convertSolaceTopicFilterToRegex(topicFilter) {
  // convert single-level wildcard * to .*, or "any character, zero or more repetitions", ...
  // ... as well as Solace system characters "#"
  let topicFilterRegex = topicFilter.replace(/\*/g, ".*").replace(/\#/g, ".*");
  // convert multi-level wildcard > to .* if it is in a valid position in the topic filter
  if (topicFilter.lastIndexOf(">") == topicFilter.length - 1) {
    topicFilterRegex = topicFilterRegex.substring(0, topicFilterRegex.length - 1).concat(".*");
  }
  return topicFilterRegex;
}

/**
 * Attempt to serialize provided message.
 * Logs and rejects on errors, resolves with publish-safe string on success.
 * @param {object|string|number|null} message
 */
export function serializeMessage(message) {
  return new Promise((resolve, reject) => {
    try {
      // handle non-null objects
      if (typeof message === "object" && message !== null) {
        resolve(JSON.stringify(message));
      }

      // handle numbers
      if (typeof message === "number") {
        resolve(message.toString());
      }

      // handle booleans
      if (typeof message === "boolean") {
        resolve(String.valueOf(message));
      }
      // handle strings
      if (typeof message === "string") {
        resolve(message);
      }

      // handle null
      if (message === null) {
        resolve("");
      }
    } catch (error) {
      /**
       * if you pass an object to this function that can't be stringified,
       * this catch block will catch and log the error
       */
      logError(error);
      reject();
    }
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const solaceContextKey = {};

export function parse(message) {
  let container = message.getSdtContainer();
  if (container != null) {
    return JSON.parse(container.getValue());
  } else {
    return JSON.parse(message.getBinaryAttachment());
  }
}
