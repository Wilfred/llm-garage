"use strict";

/**
 * Flags `<div>` elements written without a single attribute. Such a div adds a
 * box to the DOM that nothing styles, queries or labels, so the markup reads as
 * one level deeper than it really is.
 *
 * @type {import("eslint").Rule.RuleModule}
 */
const noBareDiv = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow `<div>` elements that carry no attributes",
    },
    schema: [],
    messages: {
      bareDiv:
        "This <div> has no attributes. Drop it and keep its children, or give it a class.",
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier") return;
        if (node.name.name !== "div") return;
        if (node.attributes.length > 0) return;
        context.report({ node, messageId: "bareDiv" });
      },
    };
  },
};

module.exports = noBareDiv;
