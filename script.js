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

var nodes = {};

var changingHash = false;

window.onhashchange = function() {
	var index = decodeURI(window.location.hash.split("#")[1] || "");
	// Reset dialog.
	changingHash = true;
	$.modal.close();
	changingHash = false;
	$("#nodeinfo").empty();
	if(index in nodes) {
		var node = nodes[index];
		$("#nodeinfo").append(node.data.display);
		// Display dialog.
		$("#nodeinfo").modal();
	}
	else if(index == "about") {
		$("#about").modal();
	}
}

$(document).on($.modal.CLOSE, function() {
	if(!changingHash) {
		window.location.hash = "";
	}
});

function elemCite(source) {
	return $("<cite/>").text(ydata.sources[source].cite).linkify();
}

function elemCites(sources) {
	var sources = sources.slice();
	sources.sort();
	if(sources.length > 0) {
		var list = $("<ul/>").attr("class", "citelist");
		for(const source of sources.filter((v, i, a) => a.indexOf(v) === i)) {
			list.append($("<li/>").append(elemCite(source)));
		}
		return $("<p/>").append($("<span/>").attr("class", "info-section-header").text("Citations")).append(list);
	}
	return $("<span/>");
}

function flowTransportDesc(flowdata) {
	return flowdata.transport.map(transport => ydata.transports[transport].name).join(", ").replace(/, ([^,]*)$/, ' and $1');
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
				$(text).on("mousedown", function(edown) {
					$(text).on("mouseup mousemove", function handler(eup) {
						if (eup.type === "mouseup" && Math.abs(edown.pageX - eup.pageX) < 5 && Math.abs(edown.pageY - eup.pageY) < 5) {
							window.location.hash = "#" + node.data.index;
						}
						$(text).off("mouseup mousemove", handler);
					});
				});
				nodes[node.data.index] = node;
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

			for(var industry in ydata.industries) {
				ydata.industries[industry].demanders = ydata.industries[industry].demanders || [];
				ydata.industries[industry].suppliers = ydata.industries[industry].suppliers || [];
			}

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

							// Combined citation from freight and flow.
							ydata.flows[index].cite = (ydata.freight[freight].cite || []).concat(ydata.flows[index].cite || []);

							// Modify industry data.
							ydata.industries[supplier].demanders.push(index);
							ydata.industries[demander].suppliers.push(index);
						}
					}
				}
			}

			// Add industry nodes.
			for(var industry in ydata.industries) {
				var idata = ydata.industries[industry];

				idata.suppliers.sort();
				idata.demanders.sort();

				var inputs = null;
				var outputs = null;
				if(idata.suppliers.length > 0) {
					inputs = $("<ul/>");
					for(const flow of idata.suppliers) {
						var flowdata = ydata.flows[flow];
						inputs.append($("<li/>")
							.append($("<a/>").attr("href", "#" + nodeIndex("flow", flow)).text(ydata.freight[flowdata.freight].name))
							.append($("<span/>").text(" from "))
							.append($("<a/>").attr("href", "#" + nodeIndex("industry", flowdata.supplier)).text(ydata.industries[flowdata.supplier].name))
						);
					}
					inputs = $("<p/>").append($("<span/>").attr("class", "info-section-header").text("Inputs")).append(inputs);
				}
				if(idata.demanders.length > 0) {
					outputs = $("<ul/>");
					for(const flow of idata.demanders) {
						var flowdata = ydata.flows[flow];
						outputs.append($("<li/>")
							.append($("<a/>").attr("href", "#" + nodeIndex("flow", flow)).text(ydata.freight[flowdata.freight].name))
							.append($("<span/>").text(" to "))
							.append($("<a/>").attr("href", "#" + nodeIndex("industry", flowdata.demander)).text(ydata.industries[flowdata.demander].name))
						);
					}
					outputs = $("<p/>").append($("<span/>").attr("class", "info-section-header").text("Outputs")).append(outputs);
				}
				graph.addNode(nodeIndex("industry", industry), {
					index: nodeIndex("industry", industry),
					text: idata.name,
					type: "industry",
					display: $("<div/>").attr("class", "display display-industry").append($("<a/>").attr("href", idata.wikipedia ? ("https://en.wikipedia.org/wiki/" + encodeURI(idata.wikipedia)) : null).attr("class", "display-title").text(idata.name)).append(inputs).append(outputs).append(elemCites(idata.cite || [])),
				});
			}

			// Add flow nodes and links.
			for(var flow in ydata.flows) {
				var flowdata = ydata.flows[flow];
				var freightdata = ydata.freight[flowdata.freight];
				graph.addNode(nodeIndex("flow", flow), {
					index: nodeIndex("flow", flow),
					text: freightdata.name,
					type: "flow",
					display: $("<div/>").attr("class", "display display-flow").append($("<a/>").attr("href", freightdata.wikipedia ? ("https://en.wikipedia.org/wiki/" + encodeURI(freightdata.wikipedia)) : null).attr("class", "display-title").text(freightdata.name))
						.append($("<p/>")
							.append($("<span/>").text("From "))
							.append($("<a/>").text(ydata.industries[flowdata.supplier].name).attr("href", "#" + nodeIndex("industry", flowdata.supplier)))
							.append($("<span/>").text(" to "))
							.append($("<a/>").text(ydata.industries[flowdata.demander].name).attr("href", "#" + nodeIndex("industry", flowdata.demander)))
						)
						.append($("<p/>").text("Transported by: " + flowTransportDesc(flowdata)))
						.append(elemCites(flowdata.cite || [])),
				});

				graph.addLink(nodeIndex("industry", flowdata.supplier), nodeIndex("flow", flow));
				graph.addLink(nodeIndex("flow", flow), nodeIndex("industry", flowdata.demander));
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

			// Activate hash system on page (re-)load.
			if(window.location.hash) {
				$(window).trigger("hashchange");
			}
		}
	});
};
