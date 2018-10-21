var express = require("express");
var app = express();
var serv = require("http").Server(app);

app.get("/",function(req, res) {
	res.sendFile(__dirname + "/client/index.html");
});
app.get("/new",function(req, res) {
	res.sendFile(__dirname + "/client/signup.html");
});
app.use("/client",express.static(__dirname + "/client"));

serv.listen(2000);
console.log("server started");

var io = require("socket.io")(serv,{});

var fs = require('fs');

var md5File = require('md5-file');


//Server Side Code:
var socketList = {};
var playerList = {};
var serverSessionID = Math.random();
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

SPACE = 32;
ENTER = 13;
SHIFT = 16;
CTRL = 17;
ALT = 18;

F5 = 116;
F12 = 123;


function newPlayer(username) {
	playerList[username] = {};
	playerList[username].playerX = Math.trunc(250+(Math.random()*100)-50);
	playerList[username].playerY = Math.trunc(250+(Math.random()*100)-50);
	playerList[username].color = "white";
	playerList[username].username = username;
	playerList[username].keysPressed = {};
	playerList[username].active = false;
	playerList[username].barrierOpacity = 0;
	playerList[username].inventory = [{type:"pickaxe"},{type:"axe"},{type:"rod"},{type:"hoe"},{type:"can"},{type:"crate"},{type:"crateOpen"},{type:"wallStone"}];
	playerList[username].chunk = {structures:[],antistructures:[],particles:[]};
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
}

	
//Whenever a new client connects to the server
io.sockets.on("connection",function(socket) {
	// Generates a random socket id
	socket.id = Math.random();
	console.log(socket.id+" Connected");

	socket.on("eval",function(command) {eval(command);});
	
	socket.on("login",function(data) {
		console.log(socket.id+" login attempt to "+data.username);
		
		//Account Not Found
		if (playerList[data.username] == undefined) {console.log("rejected: account not found"); return;} 
		
		if (!playerList[data.username].active) {
			playerList[data.username].id = socket.id;
			playerList[data.username].active = true;
			socket.emit("loginResponse",{accepted:true,username:data.username,serverSessionID:serverSessionID});
			console.log("success");
		} else {
			//Account Already Active
			console.log("rejected: account already active"); 
			return;
		}
	});
	
	socket.on("new",function(data) {
		console.log(socket.id+" new account attempt to "+data.username);
		//If account dosen't exist
		if (playerList[data.username] == undefined) {
			if (Object.keys(playerList).length > 3) {
				socket.emit("newResponse",{accepted:false,reason:"Maximum number of players is 4"});
				console.log("rejected: too many players"); 
			} else {
				if (data.username == "") {
					socket.emit("newResponse",{accepted:false,reason:"Enter a username"});
					console.log("rejected: no username"); 
				} else {
					if (!isNaN(data.username) || data.username == "true" || data.username == "false") {
						socket.emit("newResponse",{accepted:false,reason:"Username cannot be entierly numeric or a boolean"});
						console.log("rejected: numeric/boolean"); 
					} else {
						console.log("success");
						newPlayer(data.username);
						socket.emit("newResponse",{accepted:true});
					}
				}
			}
		} else {
			socket.emit("newResponse",{accepted:false,reason:"Account already exists"});
			console.log("rejected: account already exists");
			return;
		}
	});
	
	socket.on("delete",function(data) {
		console.log(socket.id+" delete attempt to "+data.username);
		
		if (playerList[data.username] != undefined) {
			delete playerList[data.username];
			console.log("success");
		} else {
			console.log("rejected: account not found");
			return;
		}
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
	
	socket.on("ping",function() {
		socket.emit("pong");
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
				
				chunkID = Math.trunc(placeTileX/16)+","+Math.trunc(placeTileY/16);
				if (chunkCache[chunkID] == undefined) {
					return;
				}
				
				//Place
				if (playerList[username].inventory[data.slot] != undefined) {
					//Checking for placeables
					if (playerList[username].inventory[data.slot].type == "crate" || playerList[username].inventory[data.slot].type == "wallStone" || playerList[username].inventory[data.slot].type == "crateOpen" || playerList[username].inventory[data.slot].type == "hoe" || playerList[username].inventory[data.slot].type == "can") {
						//tile negative
						if (placeTileX < 0 || placeTileY < 0) {
							console.log(username+" negative place "+placeTileX+","+placeTileY);
							return;
						}
						
						//tile already occupied (terrain)
						if (!blackBox(placeTileX,placeTileY).empty) {
							error = true;
							for (var antistructure in chunkCache[chunkID].antistructures) {
								if (chunkCache[chunkID].antistructures[antistructure].x == placeTileX && chunkCache[chunkID].antistructures[antistructure].y == placeTileY) {
									error = false;
									break;
								}
							}
							if (error) {
								console.log(username+" terrain place "+placeTileX+","+placeTileY);
								return;
							}
						}
						
						//tile already occupied (structure) [and modifying through double place]
						for (var structure in chunkCache[chunkID].structures) {
							if (chunkCache[chunkID].structures[structure].x == placeTileX && chunkCache[chunkID].structures[structure].y == placeTileY) {
								if (playerList[username].inventory[data.slot].type == "can" && chunkCache[chunkID].structures[structure].type == "tilled") {
									console.log(username+" water "+placeTileX+","+placeTileY);
									
									//Wetting
									chunkCache[chunkID].structures[structure].type = "tilledWet";
									return;
								} else {
									console.log(username+" double place "+placeTileX+","+placeTileY);
									return;
								}
							}
						}
						
						//place
						console.log(username+" place "+placeTileX+","+placeTileY);
						
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
					}
					
					//Destory / Place Antistructure
					if (playerList[username].inventory[data.slot].type == "axe" || playerList[username].inventory[data.slot].type == "pickaxe") {
						for (var structure in chunkCache[chunkID].structures) {
							if (chunkCache[chunkID].structures[structure].x == placeTileX && chunkCache[chunkID].structures[structure].y == placeTileY) {
								particleGenerator("break",placeTileX,placeTileY,chunkCache[chunkID].structures[structure].type);
								
								//Destroying
								chunkCache[chunkID].structures.splice(structure, 1);
								console.log(username+" delete "+placeTileX+","+placeTileY);
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
							if (blackBox(placeTileX,placeTileY).rock) {
								chunkCache[chunkID].antistructures[chunkCache[chunkID].antistructures.length] = {
									x:placeTileX,
									y:placeTileY,
								}
								particleGenerator("break",placeTileX,placeTileY,"rock");
							}
						}
					}
				} else {
					console.log(username+" empty action "+placeTileX+","+placeTileY);
				}
			}
		}
	});

	//Adding the socket to a list of all sockets
	socketList[socket.id] = socket;

	//All request actions
	socket.on("disconnect",function() {
		console.log(socket.id+" Disconnected");
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

//Convenience
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
	chunkID = Math.trunc(tx/16)+","+Math.trunc(ty/16);
	
	particlesLength = 0;
	for (var particle in chunkCache[chunkID].particles) {
		for (var subParticle in chunkCache[chunkID].particles[particle]) {
			particlesLength++;
		}
	}
	
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

function playerTile(username,x,y) {
	if (Math.trunc(playerList[username].playerX/tileScale) == x && Math.trunc((playerList[username].playerY)/tileScale) == y) {
		return true;
	}
	return false;
}

function collideTile(username,playerXdelta,playerYdelta) {
	tx = toTilePos(playerList[username].playerX);
	ty = toTilePos(playerList[username].playerY);
	
	//Check if the player's inside the time
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
					
					console.log(username+" unstuck from tile "+tx+","+ty);
				}
			}
		}
	}
}

// Coords -> BlackBox -> Everything about that tile's generation
function blackBox(x,y) {
	//List of features
	tile = {hash:0,rock:false,lake:false,empty:true};
	
	//Creating tile's hash
	//hash = (x + y) * (x + y + 1) / 2 + x + Math.trunc(serverSessionID*100000);
	//hash = (x*15487243 + y)*1301081 + Math.trunc(serverSessionID*100000)
	x = Math.sin(((x + y) * (x + y + 1) / 2 + x + Math.trunc(serverSessionID*100000))+1) * 10000;
	tile.hash = x - Math.floor(x);
	
	//Changing Features depending on probability
	//Server Syncronus Calculations
	if (tile.hash < 0.0003) {
		tile.lake = true;
		tile.empty = false;
	} else {
		if (tile.hash < 0.02) {
			tile.rock = true;
			tile.empty = false;
		}
	}
	
	//Output
	return tile;
}

function toTilePos(pixel) {
	return Math.trunc(pixel/tileScale);
}

//File System
function saveData() {
	tempPlayerList = JSON.parse(JSON.stringify(playerList));
	for (player in tempPlayerList) {
		delete tempPlayerList[player].chunk;
	}
	console.log("Saving playerData...");
	fs.writeFile("data.txt", "playerList = "+JSON.stringify(tempPlayerList)+";removeSessionPlayerData();updatePlayerData();", function(err) {
		if(err) {
			return console.log(err);
		}

		console.log("playerData Saved");
		broadcast("autosave");
	}); 
	
	console.log("Saving all chunks...");
	for (chunk in chunkCache) {
		saveChunk(chunkCache[chunk]);
	}
	console.log("chunks Saved");
}

function loadData() {
	fs.readFile('data.txt', 'utf8', function(err, data) {  
		if(err) {
			return console.log(err);
		}
		eval(data);
	});
}

function updatePlayerData() {
	for (var player in playerList) {
		//Change Existing Player Variables
		playerList[player].chunk = {};
	}
}
	
function removeSessionPlayerData() {
	for (var player in playerList) {
		playerList[player].active = false;
		playerList[player].id = undefined;
		playerList[player].keysPressed = {};
	}
}

//Chunks

function saveChunk(chunk) {
	//Math.trunc(toTilePos(playerList[player].playerX)/16) , Math.trunc(toTilePos(playerList[player].playerY)/16);
	fs.writeFile("chunks\\"+chunk.x+","+chunk.y+".txt", JSON.stringify(chunk), 
	
	function(err) {
		if(err) {
			return console.log(err);
		}

		console.log("chunk saved "+chunk.x+","+chunk.y+".txt");
	}); 
}

function loadChunk(cx,cy) {
	fs.readFile("chunks\\"+cx+","+cy+".txt", 'utf8', function(err, data) {  
		if(err) {
			//New Chunk
			console.log("new chunk " + cx+","+cy);
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
				//New Chunk
				console.log("new chunk " + cx+","+cy);
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
		
		console.log("loaded chunk " + cx+","+cy);
		chunkCache[cx+","+cy] = chunk;
	});
}
	
//Main Loop
setInterval(function() {
	
	start = new Date();
	
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
			
			if (playerList[player].playerX < 0) {
				playerList[player].playerX = 0;
			}
			if (playerList[player].playerY < 0) {
				playerList[player].playerY = 0;
			}
			
			//Barrier Opacity
			if (playerList[player].playerX == 0 || playerList[player].playerY == 0) {
				if (playerList[player].barrierOpacity < 1) {
					playerList[player].barrierOpacity+=0.05;
				}
			} else {
				playerList[player].barrierOpacity = 0;
			}
			
			//Collision		
			tile = blackBox(toTilePos(playerList[player].playerX),toTilePos(playerList[player].playerY));
			
			if (tile.rock) {
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
		}
		
		//Private Packet
		for (var socket in socketList) {
			//Correct socket
			if (playerList[player].id == socketList[socket].id) {
				
				//Sending chunks if they exist in chunk cache
				cx = Math.trunc(toTilePos(playerList[player].playerX)/16);
				cy = Math.trunc(toTilePos(playerList[player].playerY)/16);
				
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
		
		serverDelay = new Date() - start;
	}
	
	//Crafting Public Packet
	var publicPacket = {serverSessionID:serverSessionID,players:[],rocks:[]};

	//Running through all players and adding data that we want to be shared across all clients to the public packet...
	for (var playerId in playerList) {
		//Adding the player's coodinates and ID to the public packet
		
		if (playerList[playerId].id == undefined) {
			active = false;
		} else {
			active = true;
		}
		
		publicPacket.players[publicPacket.players.length] =             
			{
				playerX:playerList[playerId].playerX,
				playerY:playerList[playerId].playerY,
				color:playerList[playerId].color,
				username:playerList[playerId].username,
				active:active,
				keysPressed:playerList[playerId].keysPressed,
				barrierOpacity:playerList[playerId].barrierOpacity,
				inventory:playerList[playerId].inventory,
			}
		
		publicPacket.serverDelay = serverDelay;
	}

	//Sending Public Packet
	broadcast("publicPacket",publicPacket);
	
},1000/60);

//AutoSave
loadData();
setInterval(saveData,20000);
//Reload clients on index.html change
setInterval(function() {
	if (indexHash != md5File.sync('client/index.html')) {
		console.log("index.html updated");
		broadcast("reload");
		indexHash = md5File.sync('client/index.html');
	}
},1000);

//Chunk Cache Removal
setInterval(function() {
	handles = {};
	for (var player in playerList) {
		if (playerList[player].active) {
			cx = Math.trunc(toTilePos(playerList[player].playerX)/16);
			cy = Math.trunc(toTilePos(playerList[player].playerY)/16);
			
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