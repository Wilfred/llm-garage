"use strict";

const test = require("node:test");
const { RuleTester } = require("eslint");
const noBareDiv = require("./no-bare-div");

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

test("no-bare-div", () => {
  ruleTester.run("no-bare-div", noBareDiv, {
    valid: [
      { code: '<div class="page-intro">{children}</div>;' },
      { code: "<div dangerouslySetInnerHTML={{ __html: html }} />;" },
      { code: "<span>{children}</span>;" },
      { code: "<Div>{children}</Div>;" },
    ],
    invalid: [
      {
        code: "<div>{children}</div>;",
        errors: [{ messageId: "bareDiv" }],
      },
      {
        code: "<div />;",
        errors: [{ messageId: "bareDiv" }],
      },
      {
        code: '<div class="page-header">\n  <div>\n    <h1>Repositories</h1>\n  </div>\n</div>;',
        errors: [{ messageId: "bareDiv" }],
      },
    ],
  });
});
