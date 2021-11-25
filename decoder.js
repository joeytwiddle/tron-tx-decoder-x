const {utils} = require('ethers')

class TronTxDecoder {

    /**
     * Create a TronTxDecoder object
     *
     * @param {Object} config the rootchain configuration object
     * @return {TronTxDecoder} a TronWeb object
     *
     */
    constructor({tronweb}) {
        this.tronWeb = tronweb
    }

    /**
     * Decode result data from the transaction hash
     *
     * @method decodeResultById
     * @param {string} transactionID the transaction hash
     * @return {Object} decoded result with method name
     */
    async decodeResultById(transactionID) {
        try {
            let transaction = await this._getTransaction(transactionID)
            let data = '0x' + transaction.raw_data.contract[0].parameter.value.data
            let contractAddress = transaction.raw_data.contract[0].parameter.value.contract_address
            if (contractAddress === undefined)
                throw 'No Contract found for this transaction hash.'
            let abi = await this._getContractABI(contractAddress)

            const resultInput = this._extractInfoFromABI(data, abi)
            let functionABI = abi.find(i => i.name === resultInput.method)

            if (!functionABI.outputs)
                return {
                    methodName: resultInput.method,
                    outputNames: {},
                    outputTypes: {},
                    decodedOutput: {_length: 0},
                }
            let outputType = functionABI.outputs
            const types = outputType.map(({type}) => type)
            const names = resultInput.namesOutput
            names.forEach(function (n, l) {
                this[l] || (this[l] = null)
            }, names)

            var encodedResult = await this._getHexEncodedResult(transactionID)
            if (!encodedResult.includes('0x')) {
                let resMessage = ''
                let i = 0, l = encodedResult.length
                for (; i < l; i += 2) {
                    let code = parseInt(encodedResult.substr(i, 2), 16)
                    resMessage += String.fromCharCode(code)
                }

                return {
                    methodName: resultInput.method,
                    outputNames: names,
                    outputTypes: types,
                    decodedOutput: resMessage,
                }

            }

            var outputs = utils.defaultAbiCoder.decode(types, encodedResult)
            let outputObject = {_length: types.length}
            for (var i = 0; i < types.length; i++) {
                let output = outputs[i]
                outputObject[i] = output
            }
            return {
                methodName: resultInput.method,
                outputNames: names,
                outputTypes: types,
                decodedOutput: outputObject,
            }

        } catch (err) {
            throw new Error(err)
        }
    }

    /**
     * Decode result data from the transaction hash
     *
     * @method decodeResultById
     * @param {string} transactionID the transaction hash
     * @return {Object} decoded result with method name
     */
    async decodeInputById(transactionID) {

        try {

            let transaction = await this._getTransaction(transactionID)
            let data = '0x' + transaction.raw_data.contract[0].parameter.value.data
            let contractAddress = transaction.raw_data.contract[0].parameter.value.contract_address
            if (contractAddress === undefined)
                throw 'No Contract found for this transaction hash.'
            let abi = await this._getContractABI(contractAddress)

            const resultInput = this._extractInfoFromABI(data, abi)
            var names = resultInput.namesInput
            var inputs = resultInput.inputs
            var types = resultInput.typesInput
            let inputObject = {_length: names.length}
            for (var i = 0; i < names.length; i++) {
                let input = inputs[i]
                inputObject[i] = input
            }
            return {
                methodName: resultInput.method,
                inputNames: names,
                inputTypes: types,
                decodedInput: inputObject,
            }

        } catch (err) {
            throw new Error(err)
        }
    }

    /**
     * Decode revert message from the transaction hash (if any)
     *
     * @method decodeRevertMessage
     * @param {string} transactionID the transaction hash
     * @return {Object} decoded result with method name
     */
    async decodeRevertMessage(transactionID) {

        try {

            let transaction = await this._getTransaction(transactionID)
            let contractAddress = transaction.raw_data.contract[0].parameter.value.contract_address
            if (contractAddress === undefined)
                throw 'No Contract found for this transaction hash.'

            let txStatus = transaction.ret[0].contractRet
            if (txStatus == 'REVERT') {
                let encodedResult = await this._getHexEncodedResult(transactionID)
                encodedResult = encodedResult.substring(encodedResult.length - 64, encodedResult.length)
                let resMessage = (Buffer.from(encodedResult, 'hex').toString('utf8')).replace(/\0/g, '')

                return {
                    txStatus: txStatus,
                    revertMessage: resMessage.replace(/\0/g, ''),
                }

            } else {
                return {
                    txStatus: txStatus,
                    revertMessage: '',
                }
            }

        } catch (err) {
            throw new Error(err)
        }
    }

    async _getTransaction(transactionID) {
        try {
            const transaction = await this.tronWeb.trx.getTransaction(transactionID)
            if (!Object.keys(transaction).length)
                throw 'Transaction not found'
            return transaction
        } catch (error) {
            throw error
        }
    }

    async _getHexEncodedResult(transactionID) {
        try {
            const transaction = await this.tronWeb.trx.getTransactionInfo(transactionID)
            if (!Object.keys(transaction).length)
                throw 'Transaction not found'
            return '' == transaction.contractResult[0] ? transaction.resMessage : '0x' + transaction.contractResult[0]
        } catch (error) {
            throw error
        }
    }

    async _getContractABI(contractAddress) {
        try {
            const contract = await this.tronWeb.trx.getContract(contractAddress)
            if (contract.Error)
                throw 'Contract does not exist'
            return contract.abi.entrys
        } catch (error) {
            throw error
        }
    }

    _genMethodId(methodName, types) {
        const input = methodName + '(' + (types.reduce((acc, x) => {
            acc.push(this._handleInputs(x))
            return acc
        }, []).join(',')) + ')'

        return utils.keccak256(Buffer.from(input)).slice(2, 10)
    }

    _extractInfoFromABI(data, abi) {

        const dataBuf = Buffer.from(data.replace(/^0x/, ''), 'hex')

        const methodId = Array.from(dataBuf.subarray(0, 4), function (byte) {
            return ('0' + (byte & 0xFF).toString(16)).slice(-2)
        }).join('')

        var inputsBuf = dataBuf.subarray(4)

        return abi.reduce((acc, obj) => {
            if (obj.type === 'constructor') return acc
            if (obj.type === 'event') return acc
            const method = obj.name || null
            let typesInput = obj.inputs ? obj.inputs.map(x => {
                if (x.type === 'tuple[]') {
                    return x
                } else {
                    return x.type
                }
            }) : []

            let typesOutput = obj.outputs ? obj.outputs.map(x => {
                if (x.type === 'tuple[]') {
                    return x
                } else {
                    return x.type
                }
            }) : []

            let namesInput = obj.inputs ? obj.inputs.map(x => {
                if (x.type === 'tuple[]') {
                    return ''
                } else {
                    return x.name
                }
            }) : []

            let namesOutput = obj.outputs ? obj.outputs.map(x => {
                if (x.type === 'tuple[]') {
                    return ''
                } else {
                    return x.name
                }
            }) : []
            const hash = this._genMethodId(method, typesInput)
            if (hash === methodId) {
                let inputs = []

                inputs = utils.defaultAbiCoder.decode(typesInput, inputsBuf)

                return {
                    method,
                    typesInput,
                    inputs,
                    namesInput,
                    typesOutput,
                    namesOutput,
                }
            }
            return acc
        }, {method: null, typesInput: [], inputs: [], namesInput: [], typesOutput: [], namesOutput: []})
    }

    _handleInputs(input) {
        let tupleArray = false
        if (input instanceof Object && input.components) {
            input = input.components
            tupleArray = true
        }

        if (!Array.isArray(input)) {
            if (input instanceof Object && input.type) {
                return input.type
            }

            return input
        }

        let ret = '(' + input.reduce((acc, x) => {
            if (x.type === 'tuple') {
                acc.push(this._handleInputs(x.components))
            } else if (x.type === 'tuple[]') {
                acc.push(this._handleInputs(x.components) + '[]')
            } else {
                acc.push(x.type)
            }
            return acc
        }, []).join(',') + ')'

        if (tupleArray) {
            return ret + '[]'
        }
    }
}

module.exports = TronTxDecoder
