'use strict'

const fs = require('fs')
const path = require('path')
const parse5 = require('parse5')
const lodash = require('lodash')
const { optimize } = require('svgo')
const { red, green, blue, cyan, bold } = require('kolorist')
const { createHash } = require('crypto')

// (patch)
function getHash(text, length = 8) {
	const h = createHash('sha256').update(text).digest('hex').substring(0, length)
	if (length <= 64) return h
	return h.padEnd(length, '_')
}

const plugin_name = 'html-inline-svg'
const default_options = {
	svgo: {
		plugins: ['removeComments']
	},
	cacheDir: "./svg-cache",
	root: "./src",
}

const isNodeValidInlineImage = node => {
	if (node.nodeName !== 'img') return false
	return lodash.filter(node.attrs, { name: 'inline' }).length
}

const getImagesSrc = node => {
	const src = lodash.find(node.attrs, { name: 'src' })
	if (!src) return ''

	const value = src.value
	return value && value.indexOf('.svg') !== -1 ? value : ''
}

const getInlineImages = (fragment, buffer) => {
	if (!buffer) buffer = []

	if (fragment.childNodes && fragment.childNodes.length) {
		fragment.childNodes.forEach((childNode) => {
			if (isNodeValidInlineImage(childNode)) {
				buffer.push(childNode)
			} 
			else {
				buffer = getInlineImages(childNode, buffer)
			}
		})
	}

	return buffer
}

const mkdirp = (path)=>{
	return new Promise((resolve, reject) => {
		fs.access(path, fs.constants.F_OK, (err)=>{
			if (err) {
				fs.mkdir(path, { recursive: true }, (err)=>{
					if (err) reject(err)
					resolve()
				})
			} else resolve()
		})
	})
}

const convertFile = (filepath,options) => {
	return new Promise((resolve, reject) => {
		fs.readFile(filepath, 'utf8', (err, data) => {
			if (err) return reject(err)
			const hash = getHash(data)
			mkdirp(options.cacheDir).catch(reject).then(()=>{
				const cacheFile = path.resolve(path.join(options.cacheDir,hash))
				fs.access(cacheFile,fs.constants.F_OK,(err)=>{
					if (err) {
						console.info(`${cyan(plugin_name)}\tprocess: ${filepath}`)
						const result = optimize(data, options.svgo)
						const optimised = result.data
						fs.writeFile(cacheFile,optimised,(err)=>{
							if (err) reject(err)
							resolve(optimised)
						})
					} else {
						fs.readFile(cacheFile,'utf-8', (err,cacheData)=>{
							if (err) reject(err)
							resolve(cacheData)
						})
					}
				})
			})
		})
	})
}

const processInlineImage = (html, options) => {

	const fragment = parse5.parseFragment(html, {
		sourceCodeLocationInfo: true,
	})
	const image = getInlineImages(fragment)[0]

	if (!image) return Promise.resolve(html)

	return new Promise((resolve, reject) => {
		const src = getImagesSrc(image)
		const filepath = path.resolve(path.join(options.root,src))
		console.info(src)

		convertFile(filepath,options).then(optimised=>{
			html = replaceImageWithSVG(html, image, optimised)
			resolve(html)
		}).catch(reject).catch((err)=>{
			console.error(`${bold(red('Error'))}: ${cyan(plugin_name)} (${filepath})`, err)
			reject(err)
		})
	})
}

const replaceImageWithSVG = (html, image, svg) => {
	
	const attrs = image.attrs.reduce((acc, attr) => {
		const { name, value } = attr
		return name !== 'inline'
			&& name !== 'src'
			? acc + `${name}="${value}" `
			: acc
	}, '')

	if (attrs) {
		svg = svg.replace('<svg', `<svg ${attrs}`)
	}

	const start = image.sourceCodeLocation.startOffset
	const end = image.sourceCodeLocation.endOffset

	return html.substring(0, start) + svg + html.substring(end)
}

const htmlInlineSvg = options => {
	const _options = { ...default_options, ...options }
	return {
		name: plugin_name,
		transformIndexHtml(html) {
			const fragment = parse5.parseFragment(html, {
                sourceCodeLocationInfo: true
            })
			const images = getInlineImages(fragment)

			return images.reduce((promise, imageNode) =>
				promise.then(html =>
					processInlineImage(html, _options)
				)
				.catch(err => console.error(`${bold(red('Error'))}: ${cyan(plugin_name)}`, err))
			, Promise.resolve(html))
		}
	}
}

module.exports = htmlInlineSvg
module.exports.default = module.exports