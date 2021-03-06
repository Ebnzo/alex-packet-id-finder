const path = require('path')
const fs = require('fs')

module.exports = function AlexPacketIdFinder(mod) {
    const command = mod.command
	let enabled = false
	let fullPacketDefList = [...new Set(findPacketDefList())]
	let filteredPacketDefList = fullPacketDefList
	let filterExpression = '.*'
	let filterKnownPackets = true
	let packetId = null
	let showCandidateJson = true
	let rawHook = null

	function printMainStatus()
	{
		if (enabled) {
			command.message(`Packet id finder is now enabled (${packetId !== null ? 'only id ' + packetId : 'any id'}, regex /${filterExpression}/i).`)
		} else {
			command.message(`Packet id finder is now disabled.`)
		}
	}
	
	this.saveState = () => {}
	this.destructor = () =>
	{
		if(enabled) command.exec('fpi')
		command.remove('fpi')
	}
	this.loadState = state => {}
	
	command.add('fpi', (arg1, arg2) => {
		if (arg1 !== undefined) arg1 = ''+arg1
		if (arg2 !== undefined) arg2 = ''+arg2
		
		if (arg1 === undefined || ['d', 'disabled', 'false', 'no', '0'].includes(arg1.toLowerCase())) {
			enabled = false
			packetId = null
			filterExpression = '.*'
			rebuildFilteredPacketDefList()
			
			printMainStatus()
		} else if (/^\d+$/.test(arg1)) {
			enabled = true
			packetId = parseInt(arg1)
			filterExpression = '.*'
			rebuildFilteredPacketDefList()
			
			if (arg2 !== undefined) {
				filterExpression = arg2
			}
			
			printMainStatus()
		} else {
			if (arg1.toLowerCase() === 'json') {
				showCandidateJson = !showCandidateJson
				command.message(`Showing candidates as JSON is now ${showCandidateJson ? 'enabled' : 'disabled'}.`)
			} else if (['k', 'known', 'u', 'unk', 'unknown'].includes(arg1)) {
				filterKnownPackets = !filterKnownPackets
				rebuildFilteredPacketDefList()
				command.message(`Known packet filtering is now ${filterKnownPackets ? 'enabled' : 'disabled'}.`)
			} else {
				enabled = true
				packetId = null
				filterExpression = arg1
				rebuildFilteredPacketDefList()
				
				printMainStatus()
			}
		}
		if(enabled && !rawHook) rawHook = mod.hook('*', 'raw', { order: 999, type: 'all' }, rawHandler)
		else if(!enabled)
		{
			mod.unhook(rawHook)
			rawHook = null
		}
	})
	
	function findPacketDefList()
	{
		let result = []
		let basePath = require.resolve('tera-data')
		if (path.basename(basePath) === 'package.json') {
			basePath = path.dirname(basePath)
		}
		let defPath = path.join(basePath, 'protocol')
		let defFiles = fs.readdirSync(defPath)
		for (let file of defFiles) {
			let fullpath = path.join(defPath, file)

			let parsedName = path.basename(file).match(/^(\w+)\.(\d+)\.def$/)
			if (!parsedName) continue
			let name = parsedName[1]
			result.push(name)
		}
		
		return result
	}
	
	function isDefPerhapsWrong(name, packet, incoming, data, code)
	{
		if (incoming && name.slice(0, 2) === 'C_') return true
		if (!incoming && name.slice(0, 2) === 'S_') return true
		
		let data2 = mod.dispatch.toRaw(name, '*', packet)
		data2.writeUInt16LE(code, 2)
		return (data.length != data2.length) || !data.equals(data2)
	}
	
	function rebuildFilteredPacketDefList()
	{
		filteredPacketDefList = []
		let re = new RegExp(filterExpression, 'i')
		for (let name of fullPacketDefList) {
			let code = mod.dispatch.protocolMap.name.get(name)
			let known = (code !== undefined && code !== null && code !== 65535)
			if (known && filterKnownPackets) continue
			if (re.test(name)) {
				if(!known) mod.dispatch.protocolMap.name.set(name, 65535)
				// console.log(name)
				filteredPacketDefList.push(name)
			}
		}
	}
	
	function findPacketIds(code, data, incoming, fake)
	{
		let result = []
		
		for (let name of filteredPacketDefList) {
			if (incoming && name.slice(0, 2) === 'C_') continue
			if (!incoming && name.slice(0, 2) === 'S_') continue
			try {
				let packet = mod.dispatch.fromRaw(name, '*', data)
				if (!isDefPerhapsWrong(name, packet, incoming, data, code)) result.push(name)
			} catch(e) {
				// console.log(e)
			}
		}
		 
		return result
    }
	
	function loopBigIntToString(obj) {
		Object.keys(obj).forEach(key => {
			if (obj[key] && typeof obj[key] === 'object') loopBigIntToString(obj[key])
			else if (typeof obj[key] === "bigint") obj[key] = obj[key].toString()
		})
	}

	function rawHandler(code, data, incoming, fake) {
		if (!enabled) return
		if (packetId !== null && code != packetId) return
		
		let name = null
		let packet = null
		
		try {
			name = mod.dispatch.protocolMap.code.get(code)
		} catch(e) {
			name = undefined
		}
		
		let known = (name !== undefined && name !== null)
		
		if (!known || !filterKnownPackets) {
			let candidates = findPacketIds(code, data, incoming, fake)
			if (candidates.length > 0) {
				console.log(`Candidates for id ${code}: [${candidates.join(', ')}].`)
				command.message(`Candidates for id ${code}: [${candidates.join(', ')}].`)
				if (showCandidateJson) {
					for (let candidate of candidates) {
						let packet = mod.dispatch.fromRaw(candidate, '*', data)
						console.log(`${code} as ${candidate}:`)
						loopBigIntToString(packet)
						let json = JSON.stringify(packet, null, 4)
						console.log(json)
						command.message(json)
					}
				}
			}
		}
    }
};
