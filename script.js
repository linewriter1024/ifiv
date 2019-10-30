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
				var text = Viva.Graph.svg("text")
					.text(node.data.text)
					.attr("class", "node node-" + (node.data.type || "other"))
					.attr("pointer-events", "visiblePoint");
				// Node information modal.
				$(text).on("mousedown", function(edown) {
					$(text).on("mouseup mousemove", function handler(eup) {
						if (eup.type === "mouseup" && Math.abs(edown.pageX - eup.pageX) < 5 && Math.abs(edown.pageY - eup.pageY) < 5) {
							window.location.hash = "#" + node.data.index;
							$("#nodeinfo").empty();
							$("#nodeinfo").append($("<p/>").text(node.data.text));
							$("#nodeinfo").modal();
						}
						$(text).off("mouseup mousemove", handler);
					});
				});
				return text;
			}).placeNode(function(nodeUI, pos) {
				var box = nodeUI.getBBox();
                nodeUI.attr("x", pos.x - box.width / 2).attr("y", pos.y);
            });

			// Triangle/arrow marker.
			var marker = Viva.Graph.svg("marker")
				.attr("id", "triangle")
				.attr("viewBox", "0 0 10 10")
				.attr("refX", "10")
				.attr("refY", "5")
				.attr("markerUnits", "strokeWidth")
				.attr("markerWidth", "20")
				.attr("markerHeight", "10")
				.attr("fill-opacity", "0")
				.attr("stroke", "#000")
				.attr("orient", "auto");
			marker.append("path").attr("d", "M 0 0 L 10 5 L 0 10 z");

			var defs = graphics.getSvgRoot().append("defs");
			defs.append(marker);

			// Directional link with arrow at end.
			graphics.link(function(link) {
				return Viva.Graph.svg("path")
						.attr("stroke", "gray")
						.attr("marker-end", "url(#triangle)");
			}).placeLink(function(linkUI, fromPos, toPos) {
				var fromUI = graphics.getNodeUI(linkUI.link.fromId);
				var toUI = graphics.getNodeUI(linkUI.link.toId);
				var fromBox = fromUI.getBBox();
				var toBox = toUI.getBBox();

				var finalFrom = geom.intersectRect(fromPos.x - fromBox.width / 2, fromPos.y - fromBox.height / 2, fromPos.x + fromBox.width / 2, fromPos.y + fromBox.height / 2, fromPos.x, fromPos.y, toPos.x, toPos.y) || fromPos;
				var finalTo = geom.intersectRect(toPos.x - toBox.width / 2, toPos.y - toBox.height / 2, toPos.x + toBox.width / 2, toPos.y + toBox.height / 2, fromPos.x, fromPos.y, toPos.x, toPos.y) || toPos;

				linkUI.attr("d", "M" + finalFrom.x + "," + finalFrom.y + "L" + finalTo.x + "," + finalTo.y);
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
					index: nodeIndex("industry", industry),
					text: ydata.industries[industry].name,
					type: "industry",
				});
			}

			// Add flow nodes and links.
			for(var flow in ydata.flows) {
				graph.addNode(nodeIndex("flow", flow), {
					index: nodeIndex("flow", flow),
					text: ydata.freight[ydata.flows[flow].freight].name,
					type: "flow",
				});

				graph.addLink(nodeIndex("industry", ydata.flows[flow].supplier), nodeIndex("flow", flow));
				graph.addLink(nodeIndex("flow", flow), nodeIndex("industry", ydata.flows[flow].demander));
			}

			var renderer = Viva.Graph.View.renderer(graph, {
				graphics: graphics,
				layout: Viva.Graph.Layout.forceDirected(graph, {
					springLength: 100,
					springCoeff: 0.0002,
					gravity: -5,
				}),
			});
			renderer.run();
		}
	});
};
