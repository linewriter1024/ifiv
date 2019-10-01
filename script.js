"use strict";

// Read YAML from URL with callbacks.
function readYAML(path, done, error) {
	return $.get(path)
	.done(function(data) {
		var parsed;
		// Attempt to load as YAML.
		try {
			parsed = jsyaml.load(data);
		}
		// Send parsing errors to the error callback.
		catch(e) {
			error(e.message);
			return;
		}
		// If successful, then run the success callback.
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
		ydata[type] = data || {};
	}, function(status) {
		error("Unable to load " + type + " database due to error: " + status);
	}))
}

// Data ready.
window.onload = function() {
	$.when.apply($, promises).then(function() {
		// If everything loaded OK, begin.
		if(!errored) {
			var graph = Viva.Graph.graph();

			var graphics = Viva.Graph.View.svgGraphics();
			graphics.node(function(node) {
				return Viva.Graph.svg('text')
						.text(node.data.text);
			})

			// Construct and finalize all flow data.
			for(var supplier in ydata.industries) {
				for(const freight of (ydata.industries[supplier].outputs || [])) {
					for(var demander in ydata.industries) {
						if(demander != supplier) {
							if((ydata.industries[demander].inputs || []).includes(freight)) {
								var index = supplier + ";" + freight + ";" + demander;
								ydata.flows[index] = Object.assign({}, {
									freight: freight,
									transport: ydata.freight[freight].transport,
									supplier: supplier,
									demander: demander,
								}, ydata.flows[index] || {});
							}
						}
					}
				}
			}

			for(var industry in ydata.industries) {
				graph.addNode("industry:" + industry, {
					text: ydata.industries[industry].name,
				});
			}

			for(var flow in ydata.flows) {
				graph.addNode("flow:" + flow, {
					text: ydata.freight[ydata.flows[flow].freight].name + " - " + ydata.flows[flow].transport.map(transport => ydata.transports[transport].name).join(", "),
				});

				graph.addLink("industry:" + ydata.flows[flow].supplier, "flow:" + flow);
				graph.addLink("flow:" + flow, "industry:" + ydata.flows[flow].demander);
			}

			var renderer = Viva.Graph.View.renderer(graph, {
				graphics: graphics
			});
			renderer.run();
		}
	});
};
