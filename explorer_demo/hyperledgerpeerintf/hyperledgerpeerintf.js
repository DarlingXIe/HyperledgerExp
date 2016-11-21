/*Copyright DTCC 2016 All Rights Reserved.
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

	http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.*/

var grep = require('simple-grep');
var fs = require('fs');

var HyperledgerPeerIntf = function() {
	const hyperLedgerRESTEndpoint = process.env.HYP_REST_ENDPOINT || "http://127.0.0.1:7050";
	var async = require('async');
	var request = require('request');

	this.chainCodes = null;

	this.restCall = function(uri,completion) {
		var obj;
		async.series( [function (callback) {
				//console.log( ' Querying Hyperledger ' ,uri);
				request(hyperLedgerRESTEndpoint+uri, function (error, response, body) {
					if (!error && response.statusCode == 200) {
						//console.log( ' resp ' , body);
						if(body == null)
							callback(null,null);
						else {
							obj = JSON.parse(body)
							callback(null,obj);
						}
					} else {
						console.log(error);
						callback(error);
						//throw error;
					}

				})
			},
			function(callback) {
				   completion(obj);
				   callback();
			 }
			]
		);

	}
}


HyperledgerPeerIntf.prototype.chain = function(callBk) {
	this.restCall('/chain',callBk);
}

HyperledgerPeerIntf.prototype.peers = function(callBk) {
	this.restCall('/network/peers',callBk);
}

HyperledgerPeerIntf.prototype.block = function(blockNum,callBk) {
	this.restCall('/chain/blocks/'+blockNum,callBk);
}

var ROOT_GO_PATH = '/opt/gopath'; ///c/Go for windows
HyperledgerPeerIntf.prototype.availableChainCodes = function(callBk) {
  if(!this.chainCodes)
	{
		var chainCodes = this.chainCodes = new Array();
		grep('shim.ChaincodeStubInterface', ROOT_GO_PATH+'/src/github.com/hyperledger/fabric/examples/chaincode/go', function(list1){
	  		//console.log(list1);
			grep('extends ChaincodeBase', ROOT_GO_PATH+'/src/github.com/hyperledger/fabric/examples/chaincode/java', function(list2){
	  			//console.log(list2);
	  			var idx = 0;
					for( var c = 0; c < list1.length; c++) {
						if(list1[c].file.match(/\.go$/))
							chainCodes.push( { "id": idx++, "name" : list1[c].file.replace(/.*\/(.*)\.go$/,'$1'),"file" : list1[c].file, "lang" : "go" , "status":"U" , "chainId":"","txCount":0});
					}

					for( var c = 0; c < list2.length; c++) {
						if(list2[c].file.match(/\.java$/))
							chainCodes.push( { "id": idx++, "name" : list2[c].file.replace(/.*\/(.*)\.java$/,'$1'),"file" : list2[c].file, "lang" : "java" , "status":"U", "chainId":"", "txCount":0});
					}

					callBk(chainCodes);

			});

		});
	} else {
		callBk(this.chainCodes);
	}
}

HyperledgerPeerIntf.prototype.chainCodeSrc = function(id,callBk) {

	try {
		var file = this.chainCodes[id].file//.replace(/\/.*?\/(.*)/,'\/$1')
		var stat = fs.statSync(file);
		var readStream = fs.createReadStream(file);
		callBk({
			"size" : stat.size,
			"readStream" : readStream
		})

	} catch (e) {
		console.log("Failed to read chaincode" , this.chainCodes[id].file, e);
		callBk( {
			"size" : 0,
			"error" : "Failed to load chaincode source.",
			"readStream" :null
		});
	}

}

var goChaincodePathLen = (process.env.GOPATH+'/src/').length;
HyperledgerPeerIntf.prototype.chainCodeDeploy = function(id,argsStr,callBk) {

	try {
		//console.log( " -- "+id+" "+argsStr + " "+this.chainCodes[id].lang + ' chainId '+this.chainCodes[id].chainId)
		if(this.chainCodes[id].lang == 'go') {
			var path = this.chainCodes[id].file.replace(/(.*)\/.*\.go/,'$1').substring(goChaincodePathLen);
			console.log('path '+ path)
			var cmd = 'peer chaincode deploy -p '+path;
			argsStr = argsStr.replace(/.*:\[(.*?),(.*)]/,'{"Function":$1,"Args":[$2]');
		} else if(this.chainCodes[id].lang == 'java') {
			var path = this.chainCodes[id].file.replace(/(.*)\/src\/.*/i,'$1');
			var cmd = 'peer chaincode deploy -l java -p '+path + ' -c '+argsStr;
		}
		console.log('Deploying chaincode ['+cmd+']');
		var c = cmd.split(" ");
		c.push('-c');
		c.push(argsStr);
		var cc = this.chainCodes;
		run_cmd(c[0],c.slice(1,c.length),function(resp) {
			if(resp.indexOf('\"error\"') > 0) {
				console.log('Error returned : '+resp);
				cc[id].chainId = null;
				cc[id].status = 'U';
				callBk(JSON.parse(resp));
			} else {
				var chainId = resp.split(':')[1].trim();
				cc[id].chainId = chainId;
				cc[id].status = 'D';
				cc[id].txCount = 0;
				console.log('chainId returned : ['+chainId+']');
				callBk({ "chainId" : chainId ,"success" : "Chain code deployed successfully."});
			}
		});
		

	} catch (e) {
		console.log("Failed to deploy chaincode" , this.chainCodes[id].file);
		callBk( {"error" : "Failed to deploy chaincode."});
	}

}

HyperledgerPeerIntf.prototype.chainCodeInvoke = function(id,argsStr,callBk) {

	try {
		console.log( " -- "+id+" "+argsStr + " "+this.chainCodes[id].lang + ' chainId '+this.chainCodes[id].chainId)
		if(!this.chainCodes[id].chainId) {
			callBk( '{"error" : "Chaincode not deployed yet."}');
			return;
		}
		if(this.chainCodes[id].lang == 'go') {
			var path = this.chainCodes[id].file.replace(/(.*)\/.*\.go/,'$1');
			var cmd = 'peer chaincode invoke -n '+this.chainCodes[id].chainId;
		} else if(this.chainCodes[id].lang == 'java') {
			var path = this.chainCodes[id].file.replace(/(.*)\/src\/.*/i,'$1');
			var cmd = 'peer chaincode invoke -l java -n '+this.chainCodes[id].chainId;
		}
		console.log('Invoking chaincode ['+cmd+']');
		var c = cmd.split(" ");
		c.push('-c');
		c.push(argsStr);
		var cc = this.chainCodes;
		run_cmd(c[0],c.slice(1,c.length),function(resp) {
			if(resp.indexOf('\"error\"') > 0) {
				console.log('Error returned : '+resp);
				callBk(JSON.parse(resp));
			} else {
				cc[id].txCount++;
				callBk({ "success" : "Chaincode invoked successfully." });
			}
		});
		

	} catch (e) {
		console.log("Failed to invoke chaincode" , this.chainCodes[id].file);
		callBk( '{"error" : "Failed to invoke chaincode."}');
	}

}

HyperledgerPeerIntf.prototype.chainCodeQuery = function(id,argsStr,callBk) {

	try {
		console.log( " -- "+id+" "+argsStr + " "+this.chainCodes[id].lang + ' chainId '+this.chainCodes[id].chainId)
		if(!this.chainCodes[id].chainId) {
			callBk( '{"error" : "Chaincode not deployed yet."}');
			return;
		}
		if(this.chainCodes[id].lang == 'go') {
			var path = this.chainCodes[id].file.replace(/(.*)\/.*\.go/,'$1');
			var cmd = 'peer chaincode query -n '+this.chainCodes[id].chainId;
		} else if(this.chainCodes[id].lang == 'java') {
			var path = this.chainCodes[id].file.replace(/(.*)\/src\/.*/i,'$1');
			var cmd = 'peer chaincode query -l java -n '+this.chainCodes[id].chainId;
		}
		//console.log('Querying chaincode ['+cmd+']');
		var c = cmd.split(" ");
		c.push('-c');
		c.push(argsStr);
		var cc = this.chainCodes;
		run_cmd(c[0],c.slice(1,c.length),function(resp) {
			if(resp.indexOf('\"error\"') > 0) {
				console.log('Error returned : '+resp);
				callBk(JSON.parse(resp));
			} else {
				var data = resp.split(': ')[1].trim();
				console.log('data returned : ['+data+']');
				callBk({ "data" : data,"success":"Chaincode query completed successfully."});
			}
		});
		

	} catch (e) {
		console.log("Failed to query chaincode" , this.chainCodes[id].file);
		callBk( '{"error" : "Failed to query chaincode."}');
	}

}


/*(function() {
    var childProcess = require("child_process");
    var oldSpawn = childProcess.spawn;
    function mySpawn() {
        console.log('spawn called');
        console.log(arguments);
        var result = oldSpawn.apply(this, arguments);
        return result;
    }
    childProcess.spawn = mySpawn;
})();*/

function run_cmd(cmd, args, callBack ) {
	console.log( ' Using Path ',process.env.PATH + " cmd ["+cmd+"] args ["+args+"]");
    var spawn = require('child_process').spawn;
    var child = spawn(cmd,args);
    var resp = "";

    child.stdout.on('data', function (buffer) { 
		//console.log(" === process ==== ",buffer.toString()) ; 
		resp += buffer.toString() 
	});
	child.stderr.on('data', function (buffer) { 
		//console.log(" === process err ==== ",buffer.toString()) ; 
		resp += buffer.toString() 
	});
    child.on('close', function(code) { 
		console.log(" === process end ==== ",code) ; 
		if(code != 0)
			callBack( '{ "error" : "Failed to execute peer command" }');
		else
			callBack (resp) 
	});
}

module.exports = new HyperledgerPeerIntf();
