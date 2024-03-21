const express = require("express");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { Server } = require('socket.io'); // Import Server from socket.io package

const app = express();

const socketio = require('socket.io');
const mediasoup = require('mediasoup');

// Load environment variables
require("dotenv").config();

// Trust the proxy
app.set('trust proxy', true);
const serverOptions = {
    key: fs.readFileSync(path.resolve(__dirname, "server", "ssl", "key.pem")),
    cert: fs.readFileSync(path.resolve(__dirname, "server", "ssl", "cert.pem")),
};

app.use(express.static("public"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
    res.send("testing home for rtc");
});

app.get('/sfu/:name', (req, res) => {
    // console.log("hii: " + __dirname)
    res.sendFile(path.join(__dirname, '/public/index.html'));
});
















let worker
let rooms = {}
let peers = {}
let transports = []
let producers = []
let consumers = []

const mediaCodecs = [
    {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
    },
    {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
            'x-google-start-bitrate': 1000,
        },
    },
]



const httpsServer = https.createServer(serverOptions, app);
const io = new Server(httpsServer);
const connections = io.of('/mediasoup')



















const createWorker = async () => {
    worker = await mediasoup.createWorker({
        rtcMinPort: 2000,
        rtcMaxPort: 2020,
    })
    console.log(`worker pid ${worker.pid}`)

    worker.on('died', error => {
        // This implies something serious happened, so kill the application
        console.error('mediasoup worker has died')
        setTimeout(() => process.exit(1), 2000) // exit in 2 seconds
    })

    return worker
}

// We create a Worker as soon as our application starts
worker = createWorker()












connections.on('connection', async socket => {
    console.log(socket.id)
    socket.emit('connection-success', {
        socketId: socket.id,
    })

    const removeItems = (items, socketId, type) => {
        items.forEach(item => {
            if (item.socketId === socket.id) {
                item[type].close()
            }
        })
        items = items.filter(item => item.socketId !== socket.id)

        return items
    }


    socket.on('disconnect', () => {
        console.log('peer disconnected')
        consumers = removeItems(consumers, socket.id, 'consumer')
        producers = removeItems(producers, socket.id, 'producer')
        transports = removeItems(transports, socket.id, 'transport')

        try {
            const { roomName } = peers[socket.id]
        delete peers[socket.id]

        rooms[roomName] = {
            router: rooms[roomName].router,
            peers: rooms[roomName].peers.filter(socketId => socketId !== socket.id)
        }
        } catch (error) {
            console.log("error during disconnectrs: "+error)
        }
        
    })

    socket.on('joinRoom', async ({ roomName }, callback) => {
        const router1 = await createRoom(roomName, socket.id);

        // Print information before storing in the peers object
        console.log("Socket ID:", socket.id);
        console.log("Room Name:", roomName);
        // console.log("Router ID:", router1.id);

        const rtpCapabilities = router1.rtpCapabilities;

        // Print RTP Capabilities before sending back to the client
        // console.log("RTP Capabilities:", rtpCapabilities);

        // Store information in the peers object
        peers[socket.id] = {
            socket,
            roomName,
            transports: [],
            producers: [],
            consumers: [],
            peerDetails: {
                name: '',
                isAdmin: false,
            }
        };

        // Print stored information
        console.log("Stored Peer Information:");
        console.log("Transports:", peers[socket.id].transports);
        console.log("Producers:", peers[socket.id].producers);
        console.log("Consumers:", peers[socket.id].consumers);
        console.log("Peer Details:", peers[socket.id].peerDetails);

        callback({ rtpCapabilities });
    });

    const addTransport = (transport, roomName, consumer) => {

        transports = [
            ...transports,
            { socketId: socket.id, transport, roomName, consumer, }
        ]

        peers[socket.id] = {
            ...peers[socket.id],
            transports: [
                ...peers[socket.id].transports,
                transport.id,
            ]
        }
    }

    const addProducer = (producer, roomName) => {
        producers = [
            ...producers,
            { socketId: socket.id, producer, roomName, }
        ]

        peers[socket.id] = {
            ...peers[socket.id],
            producers: [
                ...peers[socket.id].producers,
                producer.id,
            ]
        }
    }

    const addConsumer = (consumer, roomName) => {
        // add the consumer to the consumers list
        consumers = [
            ...consumers,
            { socketId: socket.id, consumer, roomName, }
        ]

        // add the consumer id to the peers list
        peers[socket.id] = {
            ...peers[socket.id],
            consumers: [
                ...peers[socket.id].consumers,
                consumer.id,
            ]
        }
    }

    

    // see client's socket.emit('transport-recv-connect', ...)
    socket.on('transport-recv-connect', async ({ dtlsParameters, serverConsumerTransportId }) => {
        console.log(`DTLS PARAMS: ${dtlsParameters}`)
        const consumerTransport = transports.find(transportData => (
          transportData.consumer && transportData.transport.id == serverConsumerTransportId
        )).transport
        await consumerTransport.connect({ dtlsParameters })
      })


    socket.on('consumer-resume', async ({ serverConsumerId }) => {
        console.log('consumer resume')
        const { consumer } = consumers.find(consumerData => consumerData.consumer.id === serverConsumerId)
        await consumer.resume()
      })

    const informConsumers = (roomName, socketId, id) => {
        console.log(`just joined, id ${id} ${roomName}, ${socketId}`)
        // A new producer just joined
        // let all consumers to consume this producer
        producers.forEach(producerData => {
          if (producerData.socketId !== socketId && producerData.roomName === roomName) {
            const producerSocket = peers[producerData.socketId].socket
            // use socket to send producer id to producer
            producerSocket.emit('new-producer', { producerId: id })
          }
        })
      }




    socket.on('createWebRtcTransport', async ({ consumer }, callback) => {
        // get Room Name from Peer's properties
        const roomName = peers[socket.id].roomName;

        // get Router (Room) object this peer is in based on RoomName
        const router = rooms[roomName].router;

        createWebRtcTransport(router).then(
            transport => {
                // Log all relevant information before sending it in the callback
                console.log("Created WebRTC Transport:");
                console.log("Transport ID:", transport.id);
                console.log("ICE Parameters:", transport.iceParameters);
                console.log("ICE Candidates:", transport.iceCandidates);
                console.log("DTLS Parameters:", transport.dtlsParameters);

                // Send the callback with transport information
                callback({
                    params: {
                        id: transport.id,
                        iceParameters: transport.iceParameters,
                        iceCandidates: transport.iceCandidates,
                        dtlsParameters: transport.dtlsParameters,
                    }
                });

                // add transport to Peer's properties
                addTransport(transport, roomName, consumer);
            },
            error => {
                console.log(error);
            });
    });






    const createRoom = async (roomName, socketId) => {

        let router1
        let peers = []
        if (rooms[roomName]) {
            router1 = rooms[roomName].router
            peers = rooms[roomName].peers || []
        } else {
            router1 = await worker.createRouter({ mediaCodecs, })
        }

        console.log(`Router ID: ${router1.id}`, peers.length)

        rooms[roomName] = {
            router: router1,
            peers: [...peers, socketId],
        }

        return router1
    }

    const getTransport = (socketId) => {
        const [producerTransport] = transports.filter(transport => transport.socketId === socketId && !transport.consumer)
        return producerTransport.transport
    }

    // see client's socket.emit('transport-connect', ...)
    socket.on('transport-connect', ({ dtlsParameters }) => {
        console.log('DTLS PARAMS... ', { dtlsParameters })

        getTransport(socket.id).connect({ dtlsParameters })
    })



    // see client's socket.emit('transport-produce', ...)
    socket.on('transport-produce', async ({ kind, rtpParameters, appData }, callback) => {
        // call produce based on the prameters from the client
        const producer = await getTransport(socket.id).produce({
          kind,
          rtpParameters,
        })
    
        // add producer to the producers array
        const { roomName } = peers[socket.id]
    
        addProducer(producer, roomName)
    
        informConsumers(roomName, socket.id, producer.id)
    
        console.log('Producer ID: ', producer.id, producer.kind)
    
        producer.on('transportclose', () => {
          console.log('transport for this producer closed ')
          producer.close()
        })
    
        // Send back to the client the Producer's id
        callback({
          id: producer.id,
          producersExist: producers.length>1 ? true : false
        })
      })


      socket.on('getProducers', callback => {
        //return all producer transports
        const { roomName } = peers[socket.id]
    
        let producerList = []
        producers.forEach(producerData => {
          if (producerData.socketId !== socket.id && producerData.roomName === roomName) {
            producerList = [...producerList, producerData.producer.id]
          }
        })
    
        // return the producer list back to the client
        callback(producerList)
      })




      socket.on('consume', async ({ rtpCapabilities, remoteProducerId, serverConsumerTransportId }, callback) => {
        try {
    
          const { roomName } = peers[socket.id]
          const router = rooms[roomName].router
          let consumerTransport = transports.find(transportData => (
            transportData.consumer && transportData.transport.id == serverConsumerTransportId
          )).transport
    
          // check if the router can consume the specified producer
          if (router.canConsume({
            producerId: remoteProducerId,
            rtpCapabilities
          })) {
            // transport can now consume and return a consumer
            const consumer = await consumerTransport.consume({
              producerId: remoteProducerId,
              rtpCapabilities,
              paused: true,
            })
    
            consumer.on('transportclose', () => {
              console.log('transport close from consumer')
            })
    
            consumer.on('producerclose', () => {
              console.log('producer of consumer closed')
              socket.emit('producer-closed', { remoteProducerId })
    
              consumerTransport.close([])
              transports = transports.filter(transportData => transportData.transport.id !== consumerTransport.id)
              consumer.close()
              consumers = consumers.filter(consumerData => consumerData.consumer.id !== consumer.id)
            })
    
            addConsumer(consumer, roomName)
    
            // from the consumer extract the following params
            // to send back to the Client
            const params = {
              id: consumer.id,
              producerId: remoteProducerId,
              kind: consumer.kind,
              rtpParameters: consumer.rtpParameters,
              serverConsumerId: consumer.id,
            }
    
            // send the parameters to the client
            callback({ params })
          }
        } catch (error) {
          console.log(error.message)
          callback({
            params: {
              error: error
            }
          })
        }
      })


     




})



















const createWebRtcTransport = async (router) => {
    return new Promise(async (resolve, reject) => {
        try {
            const webRtcTransport_options = {
                listenInfos: [
                    {
                        ip: '0.0.0.0', // replace with relevant IP address
                        announcedIp: '127.0.0.1',
                    }
                ],
                enableUdp: true
                // enableTcp: true,
                // preferUdp: true,

                // listenInfos :
                // [
                // {
                //     protocol         : "udp", 
                //     ip               : "0.0.0.0", 
                //     announcedAddress : "0.0.0.0"
                // }
                // ]
            }

            let transport = await router.createWebRtcTransport(webRtcTransport_options)
            console.log(`transport id: ${transport.id}`)

            transport.on('dtlsstatechange', dtlsState => {
                if (dtlsState === 'closed') {
                    transport.close()
                }
            })

            transport.on('close', () => {
                console.log('transport closed')
            })

            resolve(transport)

        } catch (error) {
            reject(error)
        }
    })
}































const port = process.env.PORT || 3000;

const start = async () => {
    try {
        httpsServer.listen(port, () => { // Use httpsServer to listen for incoming connections
            console.log(`Server is listening on port ${port}...`);
        });
    } catch (error) {
        console.error("Error starting server:", error);
    }
};













const workerSet = new Set();
const routerSet = new Set();
const transportSet = new Set();
const producerSet = new Set();
const consumerSet = new Set();
const dataProducerSet = new Set();
const dataConsumerSet = new Set();
const webRtcServerSet = new Set();

mediasoup.observer.on("newworker", (worker) => {
    console.log("new worker created [worke.pid:%d]", worker.pid);

    workerSet.add(worker.pid);

    worker.observer.on("close", () => {
        console.log("worker closed [worker.pid:%d]", worker.pid);
        workerSet.delete(worker.pid);
    });

    worker.observer.on("newrouter", (router) => {
        console.log(
            "new router created [worker.pid:%d, router.id:%s]",
            worker.pid, router.id);

        routerSet.add(router.id);

        router.observer.on("close", () => {
            console.log("router closed [router.id:%s]", router.id);
            routerSet.delete(router.id);
        });

        router.observer.on("newtransport", (transport) => {
            console.log(
                "new transport created [worker.pid:%d, router.id:%s, transport.id:%s]",
                worker.pid, router.id, transport.id);

            transportSet.add(transport.id);

            transport.observer.on("close", () => {
                console.log("transport closed [transport.id:%s]", transport.id);
                transportSet.delete(transport.id);
            });

            transport.observer.on("newproducer", (producer) => {
                console.log(
                    "new producer created [worker.pid:%d, router.id:%s, transport.id:%s, producer.id:%s]",
                    worker.pid, router.id, transport.id, producer.id);

                producerSet.add(producer.id);

                producer.observer.on("close", () => {
                    console.log("producer closed [producer.id:%s]", producer.id);
                    producerSet.delete(producer.id);
                });
            });

            transport.observer.on("newconsumer", (consumer) => {
                console.log(
                    "new consumer created [worker.pid:%d, router.id:%s, transport.id:%s, consumer.id:%s]",
                    worker.pid, router.id, transport.id, consumer.id);

                consumerSet.add(consumer.id);

                consumer.observer.on("close", () => {
                    console.log("consumer closed [consumer.id:%s]", consumer.id);
                    consumerSet.delete(consumer.id);
                });
            });

            transport.observer.on("newdataproducer", (dataProducer) => {
                console.log(
                    "new data producer created [worker.pid:%d, router.id:%s, transport.id:%s, dataProducer.id:%s]",
                    worker.pid, router.id, transport.id, dataProducer.id);

                dataProducerSet.add(dataProducer.id);

                dataProducer.observer.on("close", () => {
                    console.log("data producer closed [dataProducer.id:%s]", dataProducer.id);
                    dataProducerSet.delete(dataProducer.id);
                });
            });

            transport.observer.on("newdataconsumer", (dataConsumer) => {
                console.log(
                    "new data consumer created [worker.pid:%d, router.id:%s, transport.id:%s, dataConsumer.id:%s]",
                    worker.pid, router.id, transport.id, dataConsumer.id);

                dataConsumerSet.add(dataConsumer.id);

                dataConsumer.observer.on("close", () => {
                    console.log("data consumer closed [dataConsumer.id:%s]", dataConsumer.id);
                    dataConsumerSet.delete(dataConsumer.id);
                });
            });
        });
    });

    worker.observer.on("newwebrtcserver", (webRtcServer) => {
        console.log(
            "new WebRTC server created [worker.pid:%d, webRtcServer.id:%s]",
            worker.pid, webRtcServer.id);

        webRtcServerSet.add(webRtcServer.id);

        webRtcServer.observer.on("close", () => {
            console.log("WebRTC server closed [webRtcServer.id:%s]", webRtcServer.id);
            webRtcServerSet.delete(webRtcServer.id);
        });
    });
});

// Define the Express route
app.get('/details', (req, res) => {
    // Create a function to generate the HTML table for a set
    const generateTable = (setName, set) => {
        let table = `<h2>${setName}</h2><table border="1"><tr><th>ID</th></tr>`;
        set.forEach(id => {
            table += `<tr><td>${id}</td></tr>`;
        });
        table += `</table>`;
        return table;
    };

    // Generate HTML tables for each set
    let tablesHTML = '';
    tablesHTML += generateTable('Worker Set', workerSet);
    tablesHTML += generateTable('Router Set', routerSet);
    tablesHTML += generateTable('Transport Set', transportSet);
    tablesHTML += generateTable('Producer Set', producerSet);
    tablesHTML += generateTable('Consumer Set', consumerSet);
    tablesHTML += generateTable('Data Producer Set', dataProducerSet);
    tablesHTML += generateTable('Data Consumer Set', dataConsumerSet);
    tablesHTML += generateTable('WebRTC Server Set', webRtcServerSet);

    // Send the HTML response
    res.send(`<html><body>${tablesHTML}</body></html>`);
});













start();
