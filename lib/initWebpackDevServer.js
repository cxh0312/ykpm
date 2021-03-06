'use strict';

require('colors');
const url = require('url');
const fs = require('fs');
const join = require('path').join;
const Module = require('module');
const mock = require('mockjs');
const WebpackDevServer = require('webpack-dev-server');
const wildcard = require('wildcard-named');

const defaultOption = {
	contentBase: './static/',
	protocol: 'http',
	hostname: 'localhost',
	port: 8080,
	hot: true,
	inline: true,
	stats: { colors: true }
};

module.exports = function initWebpackDevServer(compiler, options) {
	let webpackServerOption = initWebpackServerConfig(Object.assign({}, defaultOption, options));
	return new WebpackDevServer(compiler, webpackServerOption);

};

function initWebpackServerConfig(opts) {
	let defaultConfig = {
		contentBase: opts.contentBase,
		hot: opts.hot,
		inline: opts.inline,
		stats: opts.stats,
		features: ['headers', 'proxy', 'setup', 'middleware', 'contentBase']
	};

	let proxyConfig = normalizeProxyConfig(opts);

	defaultConfig.proxy = initProxy(proxyConfig);

	defaultConfig.setup = initMock(proxyConfig.ajaxProxy, opts.cwd);

	return defaultConfig;
}

function normalizeProxyConfig(opts) {
	// 添加代理过滤器
	if (opts.proxyFilter) {
		Object.keys(opts.proxyFilter).forEach(function (key) {
			wildcard.addFilter(key, opts.proxyFilter[key]);
		});
	}

	let proxyConfig = {
		protocol: opts.protocol,
		hostname: opts.hostname,
		port: opts.port,
		fileProxy: {},
		ajaxProxy: {}
	};

	let proxyObj = opts.proxy || {};

	Object.keys(proxyObj).forEach(key => {
		let itemList = [].concat(proxyObj[key]);
		let urlObj = url.parse(key);

		itemList.forEach(item => {
			if (item.target) { // 代理文件
				let pathKey = urlObj.path;
				if (item.path) {
					pathKey = `${pathKey}/${item.path}`.replace(/\/+/g, '/');
				}

				let proxyItem = proxyConfig.fileProxy[urlObj.host];
				if (!proxyItem) {
					proxyItem = proxyConfig.fileProxy[urlObj.host] = {};
				}

				proxyItem[pathKey] = {
					target: item.target
				};
			}

			if (item.data) { // ajax代理
				let pathKey = urlObj.path;
				if (item.path) {
					pathKey = `${pathKey}/${item.path}`.replace(/\/+/g, '/');
				}

				let proxyItem = proxyConfig.ajaxProxy[urlObj.host];
				if (!proxyItem) {
					proxyItem = proxyConfig.ajaxProxy[urlObj.host] = {};
				}

				proxyItem[pathKey] = {
					target: item.path || pathKey,
					mock: item.data,
					jsonpName: item.jsonpName || 'jsonpcallback'
				};
			}
		});
	});

	return proxyConfig;
}

function initProxy(proxyConfig) {
	return {
		'*': {
			bypass: (req, res, proxyOptions) => {
				let curUrl = req._parsedUrl;

				// 本地web服务链接
				if (curUrl.hostname == null || (curUrl.hostname === proxyConfig.hostname && curUrl.port === proxyConfig.port)) {
					return curUrl.path;
				}

				// 文件代理
				let proxyOption;
				let proxyItem = proxyConfig.fileProxy[curUrl.host];
				if (proxyItem) {
					proxyOption = proxyItem[curUrl.pathname];
					if (!proxyOption) { // 直接匹配失败，按通配符逻辑匹配
						Object.keys(proxyItem).some(pathKey => {
							var params = wildcard(curUrl.pathname, pathKey);
							if (params) {
								let targetStr = proxyItem[pathKey].target;
								Object.keys(params).forEach(key => {
									targetStr = targetStr.replace(`[${key}]`, params[key]);
								});
								proxyOption = Object.assign({}, proxyItem[pathKey], { target: targetStr });
								return true;
							}
						});
					}
				}

				// ajax代理
				if (!proxyOption) { // 文件代理未匹配到，检查ajax代理
					proxyItem = proxyConfig.ajaxProxy[curUrl.host];
					if (proxyItem) {
						proxyOption = proxyItem[curUrl.pathname];
					}
				}

				if (proxyOption) {
					let targetObj = url.parse(proxyOption.target);

					let isLocal = !targetObj.hostname;

					Object.assign(proxyOptions, {
						ignorePath: true,
						target: url.format({
							protocol: isLocal ? proxyConfig.protocol : targetObj.protocol,
							hostname: isLocal ? proxyConfig.hostname : targetObj.hostname,
							port: isLocal ? proxyConfig.port : (targetObj.port || 80),
							pathname: targetObj.path,
							query: req.query
						})
					});

					console.log(`[proxy] ${req.url}\r\n        ↓ ↓ ↓ ↓ ↓\r\n        ${proxyOptions.target}`.green);
				} else { // 不代理
					Object.assign(proxyOptions, {
						ignorePath: false,
						target: url.format({
							protocol: curUrl.protocol,
							hostname: curUrl.hostname,
							port: curUrl.port || 80
						})
					});
				}
				return false;
			}
		}
	};
}

function initMock(proxyConfig, cwd) {
	return function (app) {
		Object.keys(proxyConfig).forEach(host => {
			let item = proxyConfig[host];

			Object.keys(item).forEach(path => {
				let method = item[path];
				let ajaxPath = method.target;
				if (ajaxPath) {
					if (!ajaxPath.startsWith('/')) {
						ajaxPath = `/${ajaxPath}`;
					}

					app.all(ajaxPath, (req, res) => {
						res.app.set('jsonp callback name', method.jsonpName);

						let data = method.mock;
						if (typeof data === 'string') {
							let filePath = join(cwd, data);
							if (fs.existsSync(filePath)) {
								try {
									let fileContent = fs.readFileSync(filePath, { encoding: 'utf8' });
									let m = new Module();
									m.Mock = mock;
									m._compile(fileContent, data);
									fileContent = m.exports;
									m = null;
									if (!fileContent || !fileContent.data) {
										console.error(`[proxy-ajax] not found function [data] in mock file:${data}`.red);
										data = undefined;
									} else {
										data = fileContent.data;
									}
								} catch (e) {
									console.error(`[proxy-ajax] ${filePath} module compile error:${e.stack}`.red);
								}
							}
						}

						if (typeof data === 'function') {
							data = data(req, res);
						}

						if (data !== undefined) {
							res[req.query[method.jsonpName] ? 'jsonp' : 'json'](mock.mock(data)).end();
						}
					});
				}
			});
		});
	};
}
