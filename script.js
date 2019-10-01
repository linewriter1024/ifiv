"use strict";

// Read YAML from URL with callbacks.
function readYAML(path, done, error) {
	return $.get(path)
	.done(function(data) {
		var parsed;
		try {
			parsed = jsyaml.load(data);
		}
		catch(e) {
			error(e.message);
			return;
		}
		done(parsed);
	})
	.fail(function(object, status, reason) {
		error(reason);
	})
}

// Have we errored?
var errored = false;
var errorReason = "";

// Display and handle critical error.
function error(reason) {
	if(!errored) {
		errored = true;
		errorReason = reason;
		alert(errorReason);
	}
}

// Container for all YAML data.
var ydata = {};

// Begin downloading all YAML data.
var promises = [];
for(const type of ["industries", "flows", "transports", "freight"]) {
	promises.push(readYAML("/data/" + type + ".yaml", function(data) {
		ydata[type] = data;
	}, function(status) {
		error("Unable to load " + type + " database due to error: " + status);
	}))
}

// Data ready.
$.when.apply($, promises).then(function() {
	// If everything loaded OK, begin.
	if(!errored) {
		console.log(ydata);
	}
})
