const fs = require("fs");
const path = require("path");
const express = require("express");
const request = require("supertest");
const { cleanNames, cleanName } = require("../middleware/cleanNames");

describe("cleanName", () => {
  test("removes spaces at either end and collapses runs, including tabs, line breaks and non-breaking spaces", () => {
    expect(cleanName("R..G OFFICE ")).toBe("R..G OFFICE");
    expect(cleanName(" ALTITUDE Godown")).toBe("ALTITUDE Godown");
    expect(cleanName("Gloria  Godown")).toBe("Gloria Godown");
    expect(cleanName("Kusumba  Godown\t")).toBe("Kusumba Godown");
    expect(cleanName("a\r\nb")).toBe("a b");
  });
  test("leaves anything that is not a string alone", () => {
    expect(cleanName(5)).toBe(5);
    expect(cleanName(null)).toBe(null);
    expect(cleanName(undefined)).toBe(undefined);
  });
});

describe("cleanNames middleware", () => {
  const app = express();
  app.use(express.json());
  app.use(cleanNames(["name", "code"]));
  app.all("/echo", (req, res) => res.json({ body: req.body }));

  test("tidies only the listed fields of a create / update", async () => {
    const res = await request(app).post("/echo").send({ name: "  Gloria  ", code: " G1 ", note: "  keep  as  is ", nested: { name: " x " }, n: 3 });
    expect(res.body.body).toEqual({ name: "Gloria", code: "G1", note: "  keep  as  is ", nested: { name: " x " }, n: 3 });
  });

  test("works for PUT and PATCH too", async () => {
    expect((await request(app).put("/echo").send({ name: " a  b " })).body.body.name).toBe("a b");
    expect((await request(app).patch("/echo").send({ name: " a  b " })).body.body.name).toBe("a b");
  });

  test("never touches a GET or a body that is not a plain object", async () => {
    expect((await request(app).get("/echo?name=%20x%20")).body.body ?? {}).toEqual({});
    const res = await request(app).post("/echo").set("Content-Type", "application/json").send(JSON.stringify([" a "]));
    expect(res.body.body).toEqual([" a "]);
  });

  test("a missing or non-text field is left out / untouched", async () => {
    const res = await request(app).post("/echo").send({ name: 7 });
    expect(res.body.body).toEqual({ name: 7 });
  });
});

describe("the masters that hold names all use it", () => {
  const routes = {
    "projectMaster.js": ["name", "shortName", "code"],
    "enterprise.js": ["name", "short_name", "business_identity"],
    "companyMaster.js": ["name", "shortName", "code"],
    "godowns.js": ["GodownName", "GodownCode"],
    "accountHeadMaster.js": ["LHeadName", "LHeadCode", "DisplayName"],
    "itemMaster.js": ["M_Name", "M_code"],
    "itemGroup.js": ["M_Name", "M_code"],
  };
  test.each(Object.entries(routes))("%s", (file, fields) => {
    const src = fs.readFileSync(path.join(__dirname, "../routes", file), "utf8");
    expect(src).toContain('require("../middleware/cleanNames")');
    expect(src).toContain(`router.use(cleanNames(${JSON.stringify(fields).replace(/","/g, '", "')}));`);
  });
});
