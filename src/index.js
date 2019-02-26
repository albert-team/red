const RedisParser = require('redis-parser')
const Net = require('net')
const URL = require('url')

const Operation = require('./operations/operation')
const PipelineOperation = require('./operations/pipeline-operation')

class YoRedis {
  constructor(config) {
    if (config instanceof Function) this.config = config
    else
      this.config = function() {
        return config || {}
      }

    this.parser = new RedisParser({
      returnReply: (reply) => {
        const operation = this._operations[0]
        const complete = operation.addReply(reply)
        if (complete) this._operations.shift()
      },
      returnError: (error) => {
        const operation = this._operations[0]
        const complete = operation.addError(error)
        if (complete) this._operations.shift()
      }
    })
  }

  connect() {
    if (this.socket) return Promise.resolve(this.socket)
    else {
      return Promise.resolve(this.config()).then((config) => {
        const url = URL.parse(
          config.url || process.env.REDIS_URL || 'redis://127.0.0.1:6379'
        )
        this.socket = Net.createConnection(url.port, url.hostname)
        this.socket
          .on('data', (data) => {
            this.parser.execute(data)
          })
          .on('error', (error) => {
            const operation = this._operations.shift()
            operation.reject(error)
          })

        this._operations = []
      })
    }
  }

  call() {
    return this.connect().then(() => {
      return new Promise((resolve, reject) => {
        this._operations.push(new Operation(resolve, reject))
        const respArray = createCommand([
          Array.prototype.slice.call(arguments, 0)
        ])
        this.socket.write(respArray)
      })
    })
  }

  callMany(commands) {
    return this.connect().then(() => {
      return new Promise((resolve, reject) => {
        this._operations.push(
          new PipelineOperation(resolve, reject, commands.length)
        )
        const respArray = createCommand(commands)
        this.socket.write(respArray)
      })
    })
  }

  end() {
    if (this.socket) {
      this.socket.end()
      this.socket = null
    }
  }
}

// -- RESP --

const bufStar = Buffer.from('*', 'ascii')
const bufDollar = Buffer.from('$', 'ascii')
const bufCrlf = Buffer.from('\r\n', 'ascii')

function createCommand(commands) {
  const respArrays = commands.map(toRESPArray)
  const buffer = Buffer.concat([...respArrays, bufCrlf])
  return buffer
}

function toRESPArray(command) {
  const respStrings = command.map(toRESPBulkString)
  const stringCount = Buffer.from(String(respStrings.length), 'ascii')
  const respArray = Buffer.concat([
    bufStar,
    stringCount,
    bufCrlf,
    ...respStrings
  ])
  return respArray
}

function toRESPBulkString(string) {
  const asciiString = Buffer.from(string, 'ascii')
  const byteLength = Buffer.from(String(asciiString.length), 'ascii')
  const totalLength =
    bufDollar.length +
    byteLength.length +
    bufCrlf.length +
    asciiString.length +
    bufCrlf.length
  const respBulkString = Buffer.concat(
    [bufDollar, byteLength, bufCrlf, asciiString, bufCrlf],
    totalLength
  )
  return respBulkString
}

module.exports = YoRedis
