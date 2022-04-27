const {utils} = require('ethers')

// This is our own fork of https://github.com/dlarchikov/tron-tx-decoder-tronweb
// which provides some functions for decoding results from raw data, without
// making any network calls.
//
// This allows us to quickly decode lots of transactions from one block.

/* Usage:

  const decoder = new TronTxDecoder({ tronweb: tronWeb });

  // You might want to cache this contract object, since it requires a slow network call to fetch it
  const contract = await tronWebRetro.contract().at(contractAddress);

  // An example, fetching transactions from our java-tron node
  const blockData = await tronWeb.trx.getBlock(blockNumber);
  const tx = blockData.transactions[3];

  const txContractAddressHex = tx.raw_data?.contract?.[0]?.parameter?.value?.contract_address;
  const txContractAddress = tronWeb.address.fromHex(txContractAddressHex);

  const { abi } = contract;
  const data = '0x' + tx.raw_data.contract[0].parameter.value.data;

  const contractRet = tx.ret?.[0]?.contractRet;
  const methodCallFailed = contractRet === 'OUT_OF_ENERGY' || contractRet === 'OUT_OF_BANDWIDTH' || contractRet === 'REVERT';

  // This is good enough for contract method calls which succeeded, but not for calls which failed
  const emptyEncodedResult = '0x0000000000000000000000000000000000000000000000000000000000000000';
  // To avoid making this network call, do not process this transaction, if you know the call failed
  const encodedResult = methodCallFailed ? await decoder._getHexEncodedResult(tx.txID) : emptyEncodedResult;

  const decodedRevertMsg = decoder.decodeRevertMessageFromTransaction(tx, encodedResult);

  // If the smart contract method call failed, the later decodes might also fail, so I recommend aborting at this point.
  if (methodCallFailed) {
    return { decodedRevertMsg };
  }
  // Example failure from decodeInput() and decodeResult(), if you don't do this:
  //     Error: insufficient data for uint256 type (arg="", coderType="uint256", value="0x", version=4.0.49)

  const decodedInput = decoder.decodeInputFromData(data, abi);

  const decodedResult = decoder.decodeResultFromData(data, encodedResult, abi);

  return { decodedInput, decodedResult, decodedRevertMsg };

*/

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
            const encodedResult = await this._getHexEncodedResult(transactionID)

            return this.decodeResultFromData(data, encodedResult, abi)
        } catch (err) {
            throw new Error(err)
        }
    }

    /**
     * Decode result data from raw data
     *
     * @method decodeResultFroMData
     * @param {string} data raw data
     * @param {string} encodedResult encoded result
     * @param {object} abi ABI
     * @return {Object} decoded result with method name
     */
    decodeResultFromData(data, encodedResult, abi) {
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
    }

    /**
     * Decode input data from the transaction hash
     *
     * @method decodeInputById
     * @param {string} transactionID the transaction hash
     * @return {Object} decoded input with method name
     */
    async decodeInputById(transactionID) {

        try {

            let transaction = await this._getTransaction(transactionID)
            let data = '0x' + transaction.raw_data.contract[0].parameter.value.data
            let contractAddress = transaction.raw_data.contract[0].parameter.value.contract_address
            if (contractAddress === undefined)
                throw 'No Contract found for this transaction hash.'
            let abi = await this._getContractABI(contractAddress)

            return this.decodeInputFromData(data, abi);
        } catch (err) {
            throw new Error(err)
        }
    }

    /**
     * Decode input data from the raw data
     *
     * @method decodeInputFromData
     * @param {string} data raw data
     * @param {object} abi ABI
     * @return {Object} decoded result with method name
     */
    decodeInputFromData(data, abi) {
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
            const encodedResult = txStatus == 'REVERT' ? await this._getHexEncodedResult(transactionID) : ''

            return this.decodeRevertMessageFromTransaction(transaction, encodedResult)
        } catch (err) {
            throw new Error(err)
        }
    }

    /**
     * Decode revert message from transaction
     *
     * @method decodeRevertMessageFromData
     * @param {object} transaction transaction object
     * @param {string} encodedResult encoded result (if any)
     * @return {Object} decoded result with method name
     */
    decodeRevertMessageFromTransaction(transaction, encodedResult) {
      const txStatus = transaction.ret[0].contractRet

      if (txStatus == 'REVERT') {
          const encodedResultNoPrefix = encodedResult.substring(encodedResult.length - 64, encodedResult.length)
          let resMessage = (Buffer.from(encodedResultNoPrefix, 'hex').toString('utf8')).replace(/\0/g, '')

          return {
              txStatus: txStatus,
              revertMessage: resMessage,
          }

      } else {
          return {
              txStatus: txStatus,
              revertMessage: '',
          }
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
