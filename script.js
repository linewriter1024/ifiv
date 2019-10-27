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
		// Display the error message.
		$("#error").text(errorReason);
	}
}

// Container for all YAML data.
var ydata = {};

// Begin downloading all YAML data.
var promises = [];
for(const type of ["industries", "flows", "transports", "freight", "sources"]) {
	promises.push(readYAML("data/" + type + ".yaml", function(data) {
		ydata[type] = data || {};
	}, function(status) {
		error("Unable to load " + type + " database due to error: " + status);
	}))
}

function nodeIndex(type, name) {
	return type + ":" + name;
}

// Data ready.
window.onload = function() {
	$.when.apply($, promises).then(function() {
		// If everything loaded OK, begin.
		if(!errored) {
			var graph = Viva.Graph.graph();
			var geom = Viva.Graph.geom();

			var graphics = Viva.Graph.View.svgGraphics();
			graphics.node(function(node) {
				return Viva.Graph.svg('text').text(node.data.text);
			}).placeNode(function(nodeUI, pos) {
				var box = nodeUI.getBBox();
                nodeUI.attr('x', pos.x - box.width / 2).attr('y', pos.y);
            });

			var marker = Viva.Graph.svg("marker")
				.attr("id", "triangle")
				.attr("viewBox", "0 0 10 10")
				.attr("refX", "10")
				.attr("refY", "5")
				.attr("markerUnits", "strokeWidth")
				.attr("markerWidth", "20")
				.attr("markerHeight", "10")
				.attr("orient", "auto");

			marker.append("path").attr("d", "M 0 0 L 10 5 L 0 10 z").attr("fill", "#F00");

			var defs = graphics.getSvgRoot().append("defs");
			defs.append(marker);

			graphics.link(function(link) {
				return Viva.Graph.svg("path")
						.attr("stroke", "gray")
						.attr("marker-end", "url(#triangle)");
			}).placeLink(function(linkUI, fromPos, toPos) {
				var fromBox = graphics.getNodeUI(linkUI.link.fromId).getBBox();
				var toBox = graphics.getNodeUI(linkUI.link.toId).getBBox();

				fromPos = geom.intersectRect(fromBox.x - fromBox.width / 2, fromBox.y - fromBox.height, fromBox.x + fromBox.width / 2, fromBox.y, fromPos.x, fromPos.y, toPos.x, toPos.y) || fromPos;
				toPos = geom.intersectRect(toBox.x - toBox.width / 2, toBox.y - toBox.height, toBox.x + toBox.width / 2, toBox.y, fromPos.x, fromPos.y, toPos.x, toPos.y) || toPos;

				linkUI.attr("d", "M" + fromPos.x + "," + fromPos.y + "L" + toPos.x + "," + toPos.y);
			});

			// Construct and finalize all flow data.
			// For all possible suppliers...
			for(var supplier in ydata.industries) {
				// For all outputs of this supplier...
				for(const freight of (ydata.industries[supplier].outputs || [])) {
					// For all possible demanders...
					for(var demander in ydata.industries) {
						// If this demander takes some of the supplier's supply, then construct the flow.
						if((ydata.industries[demander].inputs || []).includes(freight)) {
							var index = supplier + ";" + freight + ";" + demander;
							// Create flow and override with any existing flow definition.
							ydata.flows[index] = Object.assign({}, {
								// Set flow information contained in index.
								freight: freight,
								supplier: supplier,
								demander: demander,
								// Default transport to value in freight definition.
								transport: ydata.freight[freight].transport,
							}, ydata.flows[index] || {});
						}
					}
				}
			}

			// Add industry nodes.
			for(var industry in ydata.industries) {
				graph.addNode(nodeIndex("industry", industry), {
					text: ydata.industries[industry].name,
				});
			}

			for(var flow in ydata.flows) {
				graph.addNode(nodeIndex("flow", flow), {
					text: ydata.freight[ydata.flows[flow].freight].name,
				});

				graph.addLink(nodeIndex("industry", ydata.flows[flow].supplier), nodeIndex("flow", flow));
				graph.addLink(nodeIndex("flow", flow), nodeIndex("industry", ydata.flows[flow].demander));
			}

			var renderer = Viva.Graph.View.renderer(graph, {
				graphics: graphics,
			});
			renderer.run();
		}
	});
};
