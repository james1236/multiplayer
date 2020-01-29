var express = require("express");
var app = express();
var serv = require("http").Server(app);
const path = require("path");

app.all("/",function(req, res) {
	res.sendFile(__dirname + "/client/index.html");
});
app.all("/new",function(req, res) {
	res.sendFile(__dirname + "/client/signup.html");
});
app.all("/node_modules/*",function(req, res) {
	res.sendFile(__dirname + req.originalUrl.replace(/\?.*$/, ''));
});
app.use("/client",express.static(__dirname + "/client"));

var io = require("socket.io")(serv,{});

var fs = require('fs');

var md5File = require('md5-file');

var colors = require('colors');

var SimplexNoise = require('simplex-noise');

const {
  performance
} = require('perf_hooks');

var bcrypt = require('bcryptjs');
var salt = bcrypt.genSaltSync(10);

var version = 0;

colors.setTheme({
  notice: 'cyan',
  play: 'blue',
  login: 'brightGreen',
  reject: 'red',
  data: 'grey',
  error: ['brightRed','underline'],
  saving: ['gray','underline'],
  save: 'gray',
});

serv.listen(2000);
console.log("server started".inverse);
if (process.platform === 'win32') {
	log("WARNING, running in debug mode w/ reverse eval, NOT SERVER SAFE!","error");
}

//Server Side Code:
var socketList = {};
var playerList = {};
var serverSessionID = Math.random();
var simplex = new SimplexNoise(Math.trunc(serverSessionID*100000));

var indexHash = md5File.sync('client/index.html');

var tileScale = 48;
var particlesLength = 0;
var serverDelay = 0;
var chunkCache = {};

//Key Constants
LEFT = 37;
A = 65;

RIGHT = 39;
D = 68;

UP = 38;
W = 87;

DOWN = 40;
S = 83;

R = 82;
E = 69;
C = 67;

SPACE = 32;
ENTER = 13;
SHIFT = 16;
CTRL = 17;
ALT = 18;

F5 = 116;
F12 = 123;

function log(message, type) {
	if (type) {
		console.log(message[type]);
	} else {
		console.log(message);
	}
}


function newPlayer(username,password,email) {
	playerList[username] = {};
	playerList[username].playerX = Math.trunc(250+(Math.random()*40000)-50)-20000;
	playerList[username].playerY = Math.trunc(250+(Math.random()*40000)-50)-20000;
	playerList[username].color = "white";
	playerList[username].username = username;
	playerList[username].keysPressed = {};
	playerList[username].active = false;
	playerList[username].inventory = [{type:"pickaxe"},{type:"axe"},{type:"rod"},{type:"hoe"},{type:"can"},{type:"crate"},{type:"crateOpen"},{type:"wallStone"},{type:"sign"}];
	playerList[username].chunk = {structures:[],antistructures:[],particles:[]};
	playerList[username].password = bcrypt.hashSync(password, salt);
	playerList[username].email = email;
	playerList[username].epoch = (Date.now()+"");
	playerList[username].money = 0;
	playerList[username].version = version;
}

var textures = {
	"crate":[0,16,16,16],
	"crateOpen":[16,16,16,16],
	"wallStone":[48,16,16,16],
	"tree":[64,24,16,24],
	"treeDead":[80,16,16,24],
	"rock":[0,0,16,16],
	"pickaxe":[48,32,16,16],
	"axe":[32,32,16,16],
	"rod":[48,48,16,16],
	"hoe":[32,48,16,16],
	"can":[64,48,16,16],
	"tilled":[16,48,16,16],
	"tilledWet":[0,48,16,16],
	"sign":[0,64,16,16],
}

	
//Whenever a new client connects to the server
io.sockets.on("connection",function(socket) {
	// Generates a random socket id
	socket.id = Math.random();
	log(socket.id+" Connected","login");
	
	socket.on("login",function(data) {	
		//Disconnect from any previous account
		for (var player in playerList) {
			if (playerList[player].id == socket.id) {
				playerList[player].id = undefined;
				playerList[player].active = false;
			}
		}

		//Account Not Found
		if (playerList[data.username] == undefined) {
			log("rejected: account not found "+data.username,"reject");
			log("  cause: "+socket.id+" login attempt to "+data.username,"reject");
			socket.emit("loginResponse",{accepted:false,reason:"Username not found"});
			return;
		}
		
		if (!data.password) {
			log("rejected: no password provided","reject");
			log("  cause: "+socket.id+" login attempt to "+data.username,"reject");
			socket.emit("loginResponse",{accepted:false,reason:"Enter a password"});
			return;
		}
		
		if (!bcrypt.compareSync(data.password, playerList[data.username].password)) {
			log("rejected: password invalid","reject");
			log("  cause: "+socket.id+" login attempt to "+data.username,"reject");
			socket.emit("loginResponse",{accepted:false,reason:"Password invalid"});
			return;
		} 
		
		if (playerList[data.username].active && playerList[data.username].id) {
			//Account Already Active
			log("account "+data.username+" already active, disconnecting "+playerList[data.username].id, "login"); 
			
			for (var socketId in socketList) {
				if (socketList[socketId].id == playerList[data.username].id) {		
					//Disconnect socket
					//socket.on("disconnect",
					log(playerList[data.username].id+" Forced Disconnected","login");
					socketList[socketId].emit("reload");
					delete socketList[socketId];

					for (var playerId in playerList) {
						if (playerList[playerId].id == socketId) {
							//Remove Socket ID + Reset Keypresses
							playerList[playerId].id = undefined;
							playerList[playerId].active = false;
							playerList[playerId].keysPressed = {};
						}
					}
				}
			}
		}
		
		playerList[data.username].id = socket.id;
		playerList[data.username].active = true;
		socket.emit("loginResponse",{accepted:true,username:data.username,serverSessionID:serverSessionID});
		log(socket.id+" logged in to "+data.username, "login");
	});
	
	socket.on("new",function(data) {
		log(socket.id+" new account attempt to "+data.username, "login");
		//If account dosen't exist
		if (playerList[data.username] == undefined) {
			if (data.email != "") {
				for (var player in playerList) {
					if (playerList[player].email == data.email) {
						socket.emit("newResponse",{accepted:false,reason:"Email taken"});
						log("rejected: email taken", "reject"); 
						return;
					}
				}
			}
			
			if (data.username == "") {
				socket.emit("newResponse",{accepted:false,reason:"Choose a username"});
				log("rejected: no username", "reject"); 
				return;
			} else {
				if (data.username.charAt(0) == "_") {
					socket.emit("newResponse",{accepted:false,reason:"Username cannot start with underscore"});
					log("rejected: username cannot start with underscore", "reject"); 
					return;
				}
				
				if (data.password == "") {
					socket.emit("newResponse",{accepted:false,reason:"Choose a password"});
					log("rejected: no password", "reject"); 
					return;
				}					
				if (5 > data.password.length) {
					socket.emit("newResponse",{accepted:false,reason:"Password too short"});
					log("rejected: password too short", "reject"); 
					return;
				}
				if (!isNaN(data.username) || data.username == "true" || data.username == "false") {
					socket.emit("newResponse",{accepted:false,reason:"Username cannot be entierly numeric or a boolean"});
					log("rejected: numeric/boolean", "reject"); 
					return;
				} else {
					log("account created", "login");
					newPlayer(data.username, data.password, data.email);
					socket.emit("newResponse",{accepted:true,guest:false});
				}
			}
		} else {
			socket.emit("newResponse",{accepted:false,reason:"Username taken"});
			log("rejected: account already exists", "reject");
			return;
		}
	});
	
	socket.on("newGuest",function(data) {
		log(socket.id+" new _guest account attempt", "login");
		
		var pass = "00000"+(randInt(99999999999999)+"");
		do {
			var name = "_"+(randInt(99999999999999)+"");
		} while (playerList[name] != undefined);

		newPlayer(name, pass);
		log("_guest account "+name+" created", "login");
		socket.emit("newResponse",{accepted:true,guest:true,username:name,password:pass});
	});
	
	//Can't trust username from player, need to confirm with socket ID
	socket.on("updateClientData",function(data) {
		username = "";
		for (var player in playerList) {
			if (playerList[player].id == socket.id) {
				username = playerList[player].username;
			}
		}
		
		if (username) {			
			playerList[username].keysPressed = {}
			for (var key in data.keysPressed) {
				playerList[username].keysPressed[key] = data.keysPressed[key];
			}
		}
	});
	
	socket.on("action",function(data) {
		//Get username
		username = "";
		for (var player in playerList) {
			if (playerList[player].id == socket.id) {
				username = playerList[player].username;
			}
		}
		
		//Get build tile
		if (username && playerList[username].keysPressed[SHIFT]) {
			bx = 0;
			by = 0;
			
			if (playerList[username].keysPressed[LEFT] || playerList[username].keysPressed[A]) {
				bx = -1;
			} else {
				if (playerList[username].keysPressed[RIGHT] || playerList[username].keysPressed[D]) {
					bx = 1;
				}
			}
			if (playerList[username].keysPressed[UP] || playerList[username].keysPressed[W]) {
				by = -1;
			} else {
				if (playerList[username].keysPressed[DOWN] || playerList[username].keysPressed[S]) {
					by = 1;
				}
			}
			
			if (bx != 0 || by != 0) {
				placeTileX = toTilePos(playerList[username].playerX)+bx;
				placeTileY = toTilePos(playerList[username].playerY)+by;
				
				chunkID = Math.floor(placeTileX/16)+","+Math.floor(placeTileY/16);
				if (chunkCache[chunkID] == undefined) {
					return;
				}
				
				//Place
				if (playerList[username].inventory[data.slot] != undefined) {
					//Checking for placeables
					if (playerList[username].inventory[data.slot].type == "crate" || playerList[username].inventory[data.slot].type == "sign" || playerList[username].inventory[data.slot].type == "wallStone" || playerList[username].inventory[data.slot].type == "crateOpen" || playerList[username].inventory[data.slot].type == "hoe") {

						//tile already occupied (terrain)
						if (!blackBox(placeTileX,placeTileY).empty) {
							//check if antistructure exists (counterracting terrain blockage)
							error = true;
							for (var antistructure in chunkCache[chunkID].antistructures) {
								if (chunkCache[chunkID].antistructures[antistructure].x == placeTileX && chunkCache[chunkID].antistructures[antistructure].y == placeTileY) {
									error = false;
									break;
								}
							}
							if (error) {
								log(username+" terrain place "+placeTileX+","+placeTileY, "reject");
								return;
							}
						}
						
						//tile already occupied (structure) [and modifying through double place]
						for (var structure in chunkCache[chunkID].structures) {
							if (chunkCache[chunkID].structures[structure].x == placeTileX && chunkCache[chunkID].structures[structure].y == placeTileY) {
								if (playerList[username].inventory[data.slot].type == "can" && chunkCache[chunkID].structures[structure].type == "tilled") {
									log(username+" water "+placeTileX+","+placeTileY, "play");
									
									//Wetting
									chunkCache[chunkID].structures[structure].type = "tilledWet";
									return;
								} else {
									log(username+" double place "+placeTileX+","+placeTileY, "reject");
									return;
								}
							}
						}
						
						//place
						log(username+" place "+playerList[username].inventory[data.slot].type+" "+placeTileX+","+placeTileY, "play");
						
						//Placing
						chunkCache[chunkID].structures[chunkCache[chunkID].structures.length] = {
							type:playerList[username].inventory[data.slot].type,
							x:placeTileX,
							y:placeTileY,
						}
						
						if (playerList[username].inventory[data.slot].type == "hoe") {
							chunkCache[chunkID].structures[chunkCache[chunkID].structures.length-1].type = "tilled";
							chunkCache[chunkID].structures[chunkCache[chunkID].structures.length-1].noclip = true;
						}
						
						if (playerList[username].inventory[data.slot].type == "sign") {
							chunkCache[chunkID].structures[chunkCache[chunkID].structures.length-1].noclip = true;
							chunkCache[chunkID].structures[chunkCache[chunkID].structures.length-1].text = "this is a test sign";
						}
					}
					
					//Destory / Place Antistructure
					if (playerList[username].inventory[data.slot].type == "axe" || playerList[username].inventory[data.slot].type == "pickaxe") {
						for (var structure in chunkCache[chunkID].structures) {
							if (chunkCache[chunkID].structures[structure].x == placeTileX && chunkCache[chunkID].structures[structure].y == placeTileY) {
								particleGenerator("break",placeTileX,placeTileY,chunkCache[chunkID].structures[structure].type);
								
								//Destroying
								log(username+" delete "+chunkCache[chunkID].structures[structure].type+" "+placeTileX+","+placeTileY, "play");
								
								chunkCache[chunkID].structures.splice(structure, 1);
								
								broadcast("playsound",{sound:"woodbreak",x:placeTileX*tileScale,y:placeTileY*tileScale,volume:0.05});
								return;
							}
						}
						//Antistructure
						error = true;
						for (var antistructure in chunkCache[chunkID].antistructures) {
							if (chunkCache[chunkID].antistructures[antistructure].x == placeTileX && chunkCache[chunkID].antistructures[antistructure].y == placeTileY) {
								error = false;
								break;
							}
						}
						if (error) {
							if (!blackBox(placeTileX,placeTileY).empty) {
								log(username+" place antistructure "+placeTileX+","+placeTileY, "play");
								//Break terrain generation rock
								if (blackBox(placeTileX,placeTileY).rock) {
									chunkCache[chunkID].antistructures[chunkCache[chunkID].antistructures.length] = {
										x:placeTileX,
										y:placeTileY,
									}
									if (playerList[username].money != undefined) {
										playerList[username].money++;
									} else {
										playerList[username].money = 0;
									}
									particleGenerator("break",placeTileX,placeTileY,"rock");
									broadcast("playsound",{sound:"rockbreak",x:placeTileX*tileScale,y:placeTileY*tileScale,volume:0.1});
								}
							}
						}
					}
				} else {
					log(username+" empty hand action "+placeTileX+","+placeTileY, "reject");
				}
			}
		}
	});
	
	//Fishing
	socket.on("fishing:cast",function(data) {
		//Get username
		username = "";
		for (var player in playerList) {
			if (playerList[player].id == socket.id) {
				username = playerList[player].username;
			}
		}
		
		if (username) {
			if (!playerList[username].fishing) {
				playerList[username].fishing = {}
			}
			playerList[username].fishing.isFishing = true;
			playerList[username].fishing.isCasting = true;
			playerList[username].fishing.line = {};
			playerList[username].fishing.line.x = playerList[username].playerX;
			playerList[username].fishing.line.y = playerList[username].playerY;
			playerList[username].fishing.line.vel = {};
			playerList[username].fishing.line.vel.x = 4.5*data;
			playerList[username].fishing.line.vel.y = -14;
			playerList[username].fishing.line.dir = data;
			
			broadcast("playsound",{sound:"reel",x:playerList[username].playerX,y:playerList[username].playerY,volume:0.5});
			
			log("username cast rod","play");
		}
	});
	
	//For some reason "ping" is a built in socket event
	socket.on("pping",function(data) {
		socket.emit("ppong",data);
	});
	
	socket.on("fishing:stop",function() {
		//Get username
		username = "";
		for (var player in playerList) {
			if (playerList[player].id == socket.id) {
				username = playerList[player].username;
			}
		}
		
		if (username) {
			playerList[username].fishing = undefined;
			log(username+" stopped fishing","play");
		}
	});
	
	socket.on("eval",function(data) {
		//Get username
		username = "";
		for (var player in playerList) {
			if (playerList[player].id == socket.id) {
				username = playerList[player].username;
			}
		}
		
		if (process.platform === 'win32') {
			log(username+" ("+socket.id+") used EVAL","error");
			eval(data);
		} else {
			log(username+" ("+socket.id+") attempted EVAL","cyan");
		}
	});

	//Adding the socket to a list of all sockets
	socketList[socket.id] = socket;

	//Remove on disconnect
	socket.on("disconnect",function() {
		log(socket.id+" Disconnected","login");
		delete socketList[socket.id];
		
		for (var playerId in playerList) {
			if (playerList[playerId].id == socket.id) {
				//Remove Socket ID + Reset Keypresses
				playerList[playerId].id = undefined;
				playerList[playerId].active = false;
				playerList[playerId].keysPressed = {};
			}
		}
		
	});	
});

function broadcast(channel,data) {
	if (data != undefined) {
		for (var socketId in socketList) {
			socketList[socketId].emit(channel,data);
		}
	} else {
		for (var socketId in socketList) {
			socketList[socketId].emit(channel);
		}
	}
}

function particleGenerator(type,tx,ty,texture) {
	chunkID = Math.floor(tx/16)+","+Math.floor(ty/16);
	
	particlesLength = 0;
	for (var particle in chunkCache[chunkID].particles) {
		for (var subParticle in chunkCache[chunkID].particles[particle]) {
			particlesLength++;
		}
	}
	
	//Lag/memory protection
	if (particlesLength > 100) {
		chunkCache[chunkID].particles = [];
	}
	
	x=(tx*tileScale)+tileScale/2;
	y=(ty*tileScale)+tileScale/2;
	
	chunkCache[chunkID].particles[chunkCache[chunkID].particles.length] = [];
	amount = randInt(5)+2;
	
	if (type == "break") {
		for (index = 0; index < amount; index++) {
			chunkCache[chunkID].particles[chunkCache[chunkID].particles.length-1][index] = {
				x:x+(index-Math.trunc(amount/2))*2,
				y:y-tileScale/4-(randInt(101)/33),
				scale:20,
				scaleDecrement:0.0007,
				opacity:1,
				opacityDecrement:0.0001,
				pattern:"custom",
				spritex:textures[texture][0]+Math.abs(randInt(textures[texture][2]-Math.trunc(textures[texture][2]/2))),
				spritey:textures[texture][1]+Math.abs(randInt(textures[texture][3]-Math.trunc(textures[texture][2]/2))),
				spriteScale:Math.trunc(textures[texture][2]/2),
				patternParams:{
					vx:(index-Math.round(amount/2))/1.5,
					vy:1+(randInt(101)/100),
					vxdecrement:0.1,
					vydecrement:0.1,
				},
				age:0,
				maxAge:10000,
			}
		}
	}
}

//Check if player collides with tile x&y
function playerTile(username,x,y) {
	if (Math.floor(playerList[username].playerX/tileScale) == x && Math.floor((playerList[username].playerY)/tileScale) == y) {
		return true;
	}
	return false;
}

function collideTile(username,playerXdelta,playerYdelta) {
	tx = toTilePos(playerList[username].playerX);
	ty = toTilePos(playerList[username].playerY);
	
	//Check if the player's inside the tile
	if (playerTile(username,tx,ty)) {
		
		//Attempt to correct delta with as little interference as possible (avoid sticky tiles)
		playerList[username].playerY-=playerYdelta;
		if (playerTile(username,tx,ty)) {
			playerList[username].playerY+=playerYdelta;
			
			playerList[username].playerX-=playerXdelta;
			if (playerTile(username,tx,ty)) {
				playerList[username].playerY-=playerYdelta;
				
				//If corrections don't work (player stuck in collidable tile) then teleport them one tile back in X and Y
				if (playerTile(username,tx,ty)) {
					//Pop up and to the left
					playerList[username].playerX-=tileScale;
					playerList[username].playerY-=tileScale;
					
					//Allow movement in collidable
					//playerList[username].playerX+=playerXdelta;
					//playerList[username].playerY+=playerYdelta;
					
					log(username+" unstuck from tile "+tx+","+ty, "reject");
				}
			}
		}
	}
}

// Coords -> BlackBox -> Everything about that tile's generation
function blackBox(x,y) {
	//List of features
	var tile = {hash:0,rock:false,color:"",lake:false,sandpebble:false,test:false,tree:false,empty:true};
	
	//Simplex noise
	tile.clayhash = simplex.noise2D(x/20+1000, y/20+1000);
	tile.lakehash = simplex.noise2D(x/20, y/20);
	tile.rockhash = simplex.noise2D(x/1, y/1);
	tile.rockhash2 = simplex.noise2D(x/1 + 20123, y/1 + 20123);
	tile.rockhash3 = simplex.noise2D(x/1 - 20123, y/1 - 20123);
	tile.pebblehash = simplex.noise2D(x*100, y*100);
	tile.subbiomehash = simplex.noise2D(x/100, y/100);
	tile.grasshash = simplex.noise2D(x/40-1001, y/40-1001);
	
	
	let h = (1 - mapDec(simplex.noise2D(x / 80, y / 80)))*			//Octaves
			(1 - mapDec(simplex.noise2D(x / 40 + 1532, y / 40))/2)*
			(1 - mapDec(simplex.noise2D(x / 20 + 2524, y / 20))/4);
			
	let impulse = (1 - mapDec(simplex.noise2D(x / 160 + 2102, y / 160)))*			//Octaves
			(1 - mapDec(simplex.noise2D(x / 40 - 1532, y / 40))/2)*
			(1 - mapDec(simplex.noise2D(x / 20 - 2524, y / 20))/4);
			
	let global = (1 - mapDec(simplex.noise2D(x/5 / 80 + 2102, y/5 / 80)))*			//Octaves
			(1 - mapDec(simplex.noise2D(x/2.5 / 40 - 1532, y/2.5 / 40))/2)*
			(1 - mapDec(simplex.noise2D(x/1 / 20 - 2524, y/1 / 20))/4);
			
			
	//if (global > 0.35) {
	//	bw = 0;
	//	tile.mapcolor = "rgb("+bw*255+","+bw*255+","+bw*255+")";
	//}
				
	h *= h;

	if (impulse > 0.35) {
		impulse = 0;
	} else {
		impulse = 1
	}				
	
	//if (h*(global+0.5) > 0.45 * (1+(((impulse)/1)-(1/2)))) {
	oh = h;
	if (h*impulse > 0.45*((global*3)-0.25)) {
		h = 0
	} else {
		h = 1;
	}				
	
	if (h == 1 && (oh*impulse > 0.40*((global*3)-0.25))) {
		h = 0.2;
	}
	
	if (h == 1 && (h*impulse > 0.40*((global*3)-0.25))) {
		h = 0.4;
	}				
	
	if (h == 1 && oh > 0.4) {
		h = 0.3;
	}
	
	//Simplex noise
	tile.lakehash = simplex.noise2D(x/20, y/20);
	tile.subbiomehash = simplex.noise2D(x/100, y/100);
	
	if (h && tile.subbiomehash > -0.5) {
		//Default subbiome
		if (tile.lakehash < -0.7) {
			h = 0.1;
		} else {
			if (tile.lakehash < -0.55) {
				h = 0.5
			}
		}
	}
	
	if (h == 0 || h == 0.1) {
		tile.lake = true;
		tile.empty = false;
	} else {
		if (h == 0.5 || h == 0.2) {
			tile.sand = true;
		}
	}
		
	if (tile.subbiomehash > -0.5) {
		if (tile.rockhash < -0.9 && h > 0.2) {
			tile.rock = true;
			tile.empty = false;
		}
	}
	
	if (tile.empty) {
		if (!tile.sand) {
			if (tile.rockhash > 0.5*(Math.abs(tile.grasshash)+0.5) && tile.subbiomehash > 0) {
				tile.tree = true;
				tile.treeX = -Math.abs(Math.floor(Math.round(tile.rockhash2*15) / 4)*4);
				tile.treeY = -Math.abs(Math.floor(Math.round(tile.rockhash3*15) / 4)*4);
			} else {
				if (tile.grasshash < -0.5) {
					if (tile.pebblehash < 0) {
						tile.grass = true;
					}
				}
			}
		} else {
			if (tile.clayhash < -0.45 && tile.pebblehash < 0) {
				tile.sandpebble = true;
			}
		}
	}
		
	//Output
	return tile;
}

function mapDec(n) {
	return (n+1)/2
}

function toTilePos(pixel) {
	return Math.floor(pixel/tileScale);
}

//File System
function saveData() {
	tempPlayerList = JSON.parse(JSON.stringify(playerList));
	
	//Don't save chunks in player data
	for (player in tempPlayerList) {
		delete tempPlayerList[player].chunk;
	}
	
	log("Saving playerData...", "saving");
	fs.writeFile("data.txt", "playerList = "+JSON.stringify(tempPlayerList), function(err) {
		if(err) {
			return log(err,"error");
		}

		log("playerData Saved","saving");
		broadcast("autosave");
	}); 
	
	log("Saving all chunks...","saving");
	for (chunk in chunkCache) {
		saveChunk(chunkCache[chunk]);
	}
	log("chunks Saved","saving");
}

function loadData() {
	fs.readFile('data.txt', 'utf8', function(err, data) {  
		if(err) {
			return log(err,"error");
		}
		eval(data);
		removeSessionPlayerData();
		updatePlayerData();
	});
}

function updatePlayerData() {
	for (var player in playerList) {
		//Updates old player data to match current format
		playerList[player].chunk = {};
		
		//Adds signs to players without signs in their inventories
		if (playerList[player].inventory.length == 8) {
			playerList[player].inventory[8] = {type:"sign"};
		}
		
		//Gives players without version number a version number of 0
		if (playerList[player].version == undefined) {
			playerList[player].version = 0;
		}
	}
}
	
function removeSessionPlayerData() {
	for (var player in playerList) {
		playerList[player].active = false;
		playerList[player].id = undefined;
		playerList[player].keysPressed = {};
		playerList[player].fishing = {};
		playerList[player].barrierOpacity = undefined;
	}
}

function saveChunk(chunk) {
	fs.writeFile(path.join("chunks",chunk.x+","+chunk.y+".txt"), JSON.stringify(chunk), 
	
	function(err) {
		if(err) {
			return log(err);
		}

		log("chunk saved "+chunk.x+","+chunk.y+".txt", "save");
	}); 
}

function loadChunk(cx,cy) {
	fs.readFile(path.join("chunks",cx+","+cy+".txt"), 'utf8', function(err, data) {  
		if(err) {
			//New Chunk -- error case
			log("new chunk " + cx+","+cy, "save");
			chunk = {
				x:cx,
				y:cy,
				structures:[],
				antistructures:[],
				particles:[],
				serverSessionID:serverSessionID,
			}
			
			saveChunk(chunk);
		} else {
			if (data != undefined && data != "" && data != "undefined") {
				//Process Old Chunk
				chunk = JSON.parse(data);
				if (chunk.antistructures.length > 0 && chunk.serverSessionID != serverSessionID) {
					chunk.antistructures = [];
					chunk.serverSessionID = serverSessionID;
					saveChunk(chunk);
				}
			} else {
				//New Chunk -- empty data case
				log("new chunk " + cx+","+cy , "save");
				chunk = {
					x:cx,
					y:cy,
					structures:[],
					antistructures:[],
					particles:[],
					serverSessionID:serverSessionID,
				}
				
				saveChunk(chunk);
			}
		}
		
		log("loaded chunk " + cx+","+cy, "save");
		chunkCache[cx+","+cy] = chunk;
	});
}
	
//Main Loop
setInterval(function() {
	//Gameplay
	for (var player in playerList) {
		if (playerList[player].active) {
		
			//Updating User Positions
			playerXdelta = 0;
			playerYdelta = 0;
			
			if (!playerList[player].keysPressed[SHIFT]) {
				speed = 3;
				
				if (playerList[player].keysPressed[SPACE]) {
					speed = 10;
				}
				
				
				if ((playerList[player].keysPressed[LEFT] || playerList[player].keysPressed[A] || playerList[player].keysPressed[RIGHT] || playerList[player].keysPressed[D]) && (playerList[player].keysPressed[UP] || playerList[player].keysPressed[W] || playerList[player].keysPressed[DOWN] || playerList[player].keysPressed[S])) {
					speed = 2;
					if (playerList[player].keysPressed[SPACE]) {
						speed = 7;
					}
				}
				
				if (playerList[player].keysPressed[LEFT] || playerList[player].keysPressed[A]) {
					playerList[player].playerX-=speed;
					playerXdelta-=speed;
				} else {
					if (playerList[player].keysPressed[RIGHT] || playerList[player].keysPressed[D]) {
						playerList[player].playerX+=speed;
						playerXdelta+=speed;
					}
				}
				if (playerList[player].keysPressed[UP] || playerList[player].keysPressed[W]) {
					playerList[player].playerY-=speed;
					playerYdelta-=speed;
				} else {
					if (playerList[player].keysPressed[DOWN] || playerList[player].keysPressed[S]) {
						playerList[player].playerY+=speed;
						playerYdelta+=speed;
					}
				}
			}
			
			//Collision		
			tile = blackBox(toTilePos(playerList[player].playerX),toTilePos(playerList[player].playerY));
			
			if (tile.rock) {
				//Check if antistructure collision exception exists
				error = false;
				for (var antistructure in playerList[player].chunk.antistructures) {
					if (playerList[player].chunk.antistructures[antistructure].x == toTilePos(playerList[player].playerX) && playerList[player].chunk.antistructures[antistructure].y == toTilePos(playerList[player].playerY)) {
						error = true;
						break;
					}
				}
				if (!error) {
					collideTile(player,playerXdelta,playerYdelta);
				}
			}
			
			//Water Speed Reduction (trying to stop decimal places)
			if (tile.lake) {
				//x
				if (playerXdelta == 3) {
					playerList[player].playerX-=2;
				}
				if (playerXdelta == 2) {
					playerList[player].playerX-=1;
				}
				if (playerXdelta == 10) {
					playerList[player].playerX-=7;
				}
				if (playerXdelta == 7) {
					playerList[player].playerX-=5;
				}
				//y
				if (playerYdelta == 3) {
					playerList[player].playerY-=2;
				}
				if (playerYdelta == 2) {
					playerList[player].playerY-=1;
				}
				if (playerYdelta == 10) {
					playerList[player].playerY-=7;
				}
				if (playerYdelta == 7) {
					playerList[player].playerY-=5;
				}
				
				//-x
				if (playerXdelta == -3) {
					playerList[player].playerX+=2;
				}
				if (playerXdelta == -2) {
					playerList[player].playerX+=1;
				}
				if (playerXdelta == -10) {
					playerList[player].playerX+=7;
				}
				if (playerXdelta == -7) {
					playerList[player].playerX+=5;
				}
				//-y
				if (playerYdelta == -3) {
					playerList[player].playerY+=2;
				}
				if (playerYdelta == -2) {
					playerList[player].playerY+=1;
				}
				if (playerYdelta == -10) {
					playerList[player].playerY+=7;
				}
				if (playerYdelta == -7) {
					playerList[player].playerY+=5;
				}
			}
			
			//Structure Collision
			for (var structure in playerList[player].chunk.structures) {
				if (playerList[player].chunk.structures[structure].x == toTilePos(playerList[player].playerX) && playerList[player].chunk.structures[structure].y == toTilePos(playerList[player].playerY) && !playerList[player].chunk.structures[structure].noclip) {
					collideTile(player,playerXdelta,playerYdelta);
				}
			}
			
			particlesLength = 0;
			
			//Particle Adjustments
			for (var particle in playerList[player].chunk.particles) {
				for (var subParticle in playerList[player].chunk.particles[particle]) {
					
					//Lower Opacity
					playerList[player].chunk.particles[particle][subParticle].opacity-=playerList[player].chunk.particles[particle][subParticle].opacityDecrement;
					playerList[player].chunk.particles[particle][subParticle].scale-=playerList[player].chunk.particles[particle][subParticle].scaleDecrement;
				
					//Movement
					if (playerList[player].chunk.particles[particle][subParticle].pattern == "custom") {
						playerList[player].chunk.particles[particle][subParticle].x+=playerList[player].chunk.particles[particle][subParticle].patternParams.vx;
						playerList[player].chunk.particles[particle][subParticle].y+=playerList[player].chunk.particles[particle][subParticle].patternParams.vy;
						
						if (playerList[player].chunk.particles[particle][subParticle].patternParams.vx > playerList[player].chunk.particles[particle][subParticle].patternParams.vxdecrement) {
							playerList[player].chunk.particles[particle][subParticle].patternParams.vx-=playerList[player].chunk.particles[particle][subParticle].patternParams.vxdecrement;
						} else {
							if (playerList[player].chunk.particles[particle][subParticle].patternParams.vx < -playerList[player].chunk.particles[particle][subParticle].patternParams.vxdecrement) {
								playerList[player].chunk.particles[particle][subParticle].patternParams.vx+=playerList[player].chunk.particles[particle][subParticle].patternParams.vxdecrement;
							} else {
								playerList[player].chunk.particles[particle][subParticle].patternParams.vx = 0;
							}
						}
						
						if (playerList[player].chunk.particles[particle][subParticle].patternParams.vy > playerList[player].chunk.particles[particle][subParticle].patternParams.vydecrement) {
							playerList[player].chunk.particles[particle][subParticle].patternParams.vy-=playerList[player].chunk.particles[particle][subParticle].patternParams.vydecrement;
						} else {
							if (playerList[player].chunk.particles[particle][subParticle].patternParams.vy < -playerList[player].chunk.particles[particle][subParticle].patternParams.vydecrement) {
								playerList[player].chunk.particles[particle][subParticle].patternParams.vy+=playerList[player].chunk.particles[particle][subParticle].patternParams.vydecrement;
							} else {
								playerList[player].chunk.particles[particle][subParticle].patternParams.vy = 0;
							}
						}
						
					} else {
						if (playerList[player].chunk.particles[particle][subParticle].pattern == "random") {
							playerList[player].chunk.particles[particle][subParticle].x+=randInt(11)-5;
							playerList[player].chunk.particles[particle][subParticle].y+=randInt(11)-5;
						}
					}
					
					if (playerList[player].chunk.particles[particle][subParticle].opacity < 0) {
						playerList[player].chunk.particles[particle][subParticle].opacity = 0;
					}
					
					//Age
					playerList[player].chunk.particles[particle][subParticle].age++;
					
					//Delete if invisible, too small or too old
					if (playerList[player].chunk.particles[particle][subParticle].opacity <= 0 || playerList[player].chunk.particles[particle][subParticle].scale <= 0 || playerList[player].chunk.particles[particle][subParticle].age > playerList[player].chunk.particles[particle][subParticle].maxAge) {
						playerList[player].chunk.particles[particle].splice(subParticle,1);
					}
				}
				//Delete if empty particle
				if (playerList[player].chunk.particles[particle].length == 0) {
					playerList[player].chunk.particles.splice(particle,1);
				}
			}
			
			//Fishing
			if (playerList[player].fishing && playerList[player].fishing.isFishing) {
				//Update position
				playerList[player].fishing.line.x+=playerList[player].fishing.line.vel.x;
				playerList[player].fishing.line.y+=playerList[player].fishing.line.vel.y;
				
				//Update velocity (arbitrary gravity & drag values)
				if (playerList[player].fishing.isCasting) {
					
					if (playerList[player].fishing.line.dir == -1) { 
						playerList[player].fishing.line.vel.x += 0.06;
						if (playerList[player].fishing.line.vel.x > 0) {
							playerList[player].fishing.line.vel.x = 0;
						}
					} else {
						playerList[player].fishing.line.vel.x -= 0.06;
						if (playerList[player].fishing.line.vel.x < 0) {
							playerList[player].fishing.line.vel.x = 0;
						}
					}
					
					
					//Stop line
					if (playerList[player].fishing.line.y > playerList[player].playerY) {
						playerList[player].fishing.line.vel.y = 0;
						playerList[player].fishing.line.vel.x = 0;
						playerList[player].fishing.isCasting = false;
					} else {
						playerList[player].fishing.line.vel.y+=0.5;
					}
				}
			}
		}
		
		//Private Packet
		for (var socket in socketList) {
			//Correct socket
			if (playerList[player].id == socketList[socket].id) {
				
				//Sending chunks if they exist in chunk cache
				cx = Math.floor(toTilePos(playerList[player].playerX)/16);
				cy = Math.floor(toTilePos(playerList[player].playerY)/16);
				
				playerList[player].chunk = {
					structures:[],
					antistructures:[],
					particles:[],
				};
				
				for (clx = cx-1; clx < cx+2; clx++) {
					for (cly = cy-1; cly < cy+2; cly++) {
						if (chunkCache[clx+","+cly] !== undefined) {
							playerList[player].chunk.structures = playerList[player].chunk.structures.concat(chunkCache[clx+","+cly].structures);
							playerList[player].chunk.antistructures = playerList[player].chunk.antistructures.concat(chunkCache[clx+","+cly].antistructures);
							playerList[player].chunk.particles = playerList[player].chunk.particles.concat(chunkCache[clx+","+cly].particles);
						} else {
							loadChunk(clx,cly);
						}
					}
				}
				
				socketList[socket].emit("privatePacket",playerList[player].chunk);
			}
		}
	}
	
	//UPS calc
	if (typeof start !== "undefined") {
		serverDelay = performance.now() - start;
	}
	start = performance.now();
	
	//Crafting Public Packet
	var publicPacket = {serverSessionID:serverSessionID,players:[]};

	//Running through all players and adding data that we want to be shared across all clients to the public packet...
	for (var playerId in playerList) {
		//Adding the player's coodinates and ID to the public packet
		
		if (playerList[playerId].id == undefined) {
			active = false;
		} else {
			active = true;
		}
		
		//Only add active players
		if (active) {
			publicPacket.players[publicPacket.players.length] =             
				{
					//Choose what active player data is public
					playerX:playerList[playerId].playerX,
					playerY:playerList[playerId].playerY,
					color:playerList[playerId].color,
					username:playerList[playerId].username,
					active:active,
					keysPressed:playerList[playerId].keysPressed,
					inventory:playerList[playerId].inventory,
					fishing:playerList[playerId].fishing,
					money:playerList[playerId].money,
				}
			
			//Additional public packet data
			publicPacket.serverDelay = serverDelay;
		}
	}

	//Sending Public Packet
	broadcast("publicPacket",publicPacket);
	
},1000/60);

//AutoSave
loadData();
setInterval(saveData,20000);
//Reload clients on index.html change (developer tool)
setInterval(function() {
	if (indexHash != md5File.sync('client/index.html')) {
		log("Clients refreshed, index.html updated", "notice");
		broadcast("reload");
		indexHash = md5File.sync('client/index.html');
	}
},1000);

//Excess Chunk Cache Removal for each player
setInterval(function() {
	handles = {};
	for (var player in playerList) {
		if (playerList[player].active) {
			cx = Math.floor(toTilePos(playerList[player].playerX)/16);
			cy = Math.floor(toTilePos(playerList[player].playerY)/16);
			
			for (clx = cx-1; clx < cx+2; clx++) {
				for (cly = cy-1; cly < cy+2; cly++) {
					handles[clx+","+cly] = true;
				}
			}
		}
	}
	
	for (chunk in chunkCache) {
		if (handles[chunkCache[chunk].x+","+chunkCache[chunk].y] == undefined) {
			saveChunk(chunkCache[chunk]);
			delete chunkCache[chunk];
		}
	}
},2000);

function randInt(max){
	return Math.trunc(Math.random() * (max - 0));
}