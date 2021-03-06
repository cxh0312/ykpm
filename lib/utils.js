'use strict';

var path = require('path');

exports.moduleResolvePath = moduleName => {
	let filePath;
	try {
		filePath = require.resolve(moduleName);
	} catch (e) {

	}

	if (!filePath) {
		return moduleName;
	}

	moduleName = moduleName.replace(/^\.{0,2}\//, '').replace(/\/$/, '').replace(/\//g, path.sep);

	filePath = filePath.substring(0, filePath.indexOf(moduleName) + moduleName.length);

	return path.normalize(filePath);
};

exports.getFileKey = (filePath, extname) => {
	extname = extname || path.extname(filePath);
	return filePath.replace(new RegExp(extname + '$'), '');
};
