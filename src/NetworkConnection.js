var INetworkAdapter = require('./adapters/INetworkAdapter');

var ReservedDataType = { Update: 'u', Remove: 'r' };

class NetworkConnection {

  constructor(networkEntities) {
    this.entities = networkEntities;
    this.setupDefaultDataSubscriptions();

    this.connectedClients = {};
    this.activeDataChannels = {};

    this.connected = false;
    this.onConnectedEvent = new Event('connected');
    this.onPeerConnectedEvent = new Event('clientConnected');
    this.onPeerDisconnectedEvent = new Event('clientDisconnected');
    this.onDCOpenEvent = new Event('dataChannelOpened');
    this.onDCCloseEvent = new Event('dataChannelClosed');
  }

  setNetworkAdapter(adapter) {
    this.adapter = adapter;
  }

  setupDefaultDataSubscriptions() {
    this.dataChannelSubs = {};

    this.dataChannelSubs[ReservedDataType.Update]
        = this.entities.updateEntity.bind(this.entities);

    this.dataChannelSubs[ReservedDataType.Remove]
        = this.entities.removeRemoteEntity.bind(this.entities);
  }

  connect(serverUrl, appName, roomName, enableAudio = false) {
    NAF.app = appName;
    NAF.room = roomName;

    this.adapter.setServerUrl(serverUrl);
    this.adapter.setApp(appName);
    this.adapter.setRoom(roomName);

    var webrtcOptions = {
      audio: enableAudio,
      video: false,
      datachannel: true
    };
    this.adapter.setWebRtcOptions(webrtcOptions);

    this.adapter.setServerConnectListeners(
      this.connectSuccess.bind(this),
      this.connectFailure.bind(this)
    );
    this.adapter.setDataChannelListeners(
      this.dataChannelOpen.bind(this),
      this.dataChannelClosed.bind(this),
      this.receivedData.bind(this)
    );
    this.adapter.setRoomOccupantListener(this.occupantsReceived.bind(this));

    this.adapter.connect();
  }

  onConnect(callback) {
    if (this.connected) {
      callback();
    } else {
      document.body.addEventListener('connected', callback, false);
    }
  }

  connectSuccess(clientId) {
    NAF.log.write('Networked-Aframe Client ID:', clientId);
    NAF.clientId = clientId;
    this.connected = true;

    document.body.dispatchEvent(this.onConnectedEvent);
  }

  connectFailure(errorCode, message) {
    NAF.log.error(errorCode, "failure to login");
    this.connected = false;
  }

  occupantsReceived(occupantList) {
    this.checkForDisconnectingClients(this.connectedClients, occupantList);
    this.connectedClients = occupantList;
    this.checkForConnectingClients(occupantList);
  }

  checkForDisconnectingClients(oldOccupantList, newOccupantList) {
    for (var id in oldOccupantList) {
      var clientFound = newOccupantList.hasOwnProperty(id);
      if (!clientFound) {
        NAF.log.write('Closing stream to ', id);
        this.adapter.closeStreamConnection(id);
        document.body.dispatchEvent(this.onPeerDisconnectedEvent);
      }
    }
  }

  checkForConnectingClients(occupantList) {
    for (var id in occupantList) {
      var startConnection = this.isNewClient(id) && this.adapter.shouldStartConnectionTo(occupantList[id]);
      if (startConnection) {
        NAF.log.write('Opening stream to ', id);
        this.adapter.startStreamConnection(id);
        document.body.dispatchEvent(this.onPeerConnectedEvent);
      }
    }
  }

  getConnectedClients() {
    return this.connectedClients;
  }

  isConnected() {
    return this.connected;
  }

  isMineAndConnected(clientId) {
    return NAF.clientId == clientId;
  }

  isNewClient(clientId) {
    return !this.isConnectedTo(clientId);
  }

  isConnectedTo(clientId) {
    return this.adapter.getConnectStatus(clientId) === INetworkAdapter.IS_CONNECTED;
  }

  dataChannelOpen(clientId) {
    NAF.log.write('Opened data channel from ' + clientId);
    this.activeDataChannels[clientId] = true;
    this.entities.completeSync();
    document.body.dispatchEvent(this.onDCOpenEvent);
  }

  dataChannelClosed(clientId) {
    NAF.log.write('Closed data channel from ' + clientId);
    this.activeDataChannels[clientId] = false;
    this.entities.removeEntitiesFromClient(clientId);
    document.body.dispatchEvent(this.onDCCloseEvent);
  }

  hasActiveDataChannel(clientId) {
    return this.activeDataChannels.hasOwnProperty(clientId) && this.activeDataChannels[clientId];
  }

  broadcastData(dataType, data) {
    this.adapter.broadcastData(dataType, data);
  }

  broadcastDataGuaranteed(dataType, data) {
    this.adapter.broadcastDataGuaranteed(dataType, data);
  }

  sendData(toClientId, dataType, data, guaranteed) {
    if (this.hasActiveDataChannel(toClientId)) {
      if (guaranteed) {
        this.adapter.sendDataGuaranteed(toClientId, dataType, data);
      } else {
        this.adapter.sendData(toClientId, dataType, data);
      }
    } else {
      // console.error("NOT-CONNECTED", "not connected to " + toClient);
    }
  }

  sendDataGuaranteed(toClientId, dataType, data) {
    this.sendData(toClientId, dataType, data, true);
  }

  subscribeToDataChannel(dataType, callback) {
    if (this.isReservedDataType(dataType)) {
      NAF.log.error('NetworkConnection@subscribeToDataChannel: ' + dataType + ' is a reserved dataType. Choose another');
      return;
    }
    this.dataChannelSubs[dataType] = callback;
  }

  unsubscribeFromDataChannel(dataType) {
    if (this.isReservedDataType(dataType)) {
      NAF.log.error('NetworkConnection@unsubscribeFromDataChannel: ' + dataType + ' is a reserved dataType. Choose another');
      return;
    }
    delete this.dataChannelSubs[dataType];
  }

  isReservedDataType(dataType) {
    return dataType == ReservedDataType.Update
        || dataType == ReservedDataType.Remove;
  }

  receivedData(fromClientId, dataType, data) {
    if (this.dataChannelSubs.hasOwnProperty(dataType)) {
      this.dataChannelSubs[dataType](fromClientId, dataType, data);
    } else {
      NAF.log.error('NetworkConnection@receivedData: ' + dataType + ' has not been subscribed to yet. Call subscribeToDataChannel()');
    }
  }
}

module.exports = NetworkConnection;