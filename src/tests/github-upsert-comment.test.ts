import { describe, expect, it } from "vitest";
import { COMMENT_MARKER } from "@/lib/github/render-comment";
import { upsertComment } from "@/lib/github/upsert-comment";
import { fakeCommentClient, prContext } from "./helpers/github-fixtures";

const body = `${COMMENT_MARKER}\nAuthored summary`;
describe("upsertComment with an injected client", () => {
  it("creates a comment when no marker exists", async () => {
    const { client, comments } = fakeCommentClient();
    expect(await upsertComment(client, { ...prContext, body })).toEqual({
      action: "created",
      id: 1,
    });
    expect(comments).toEqual([{ id: 1, body }]);
  });
  it("updates an existing marker comment", async () => {
    const { client } = fakeCommentClient([
      { id: 4, body: `${COMMENT_MARKER}\nOld` },
    ]);
    expect(await upsertComment(client, { ...prContext, body })).toEqual({
      action: "updated",
      id: 4,
    });
    expect(client.createComment).not.toHaveBeenCalled();
    expect(client.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: 4, body }),
    );
  });
  it("never creates a second comment on repeated runs", async () => {
    const { client, comments } = fakeCommentClient();
    await upsertComment(client, { ...prContext, body });
    expect(await upsertComment(client, { ...prContext, body })).toEqual({
      action: "unchanged",
      id: 1,
    });
    await upsertComment(client, { ...prContext, body: `${body}\nNew result` });
    expect(comments).toHaveLength(1);
    expect(client.createComment).toHaveBeenCalledTimes(1);
    expect(client.updateComment).toHaveBeenCalledTimes(1);
  });
  it("leaves comments without the marker untouched", async () => {
    const { client, comments } = fakeCommentClient([
      { id: 1, body: "Human discussion" },
      { id: 2, body: null },
    ]);
    await upsertComment(client, { ...prContext, body });
    expect(comments[0].body).toBe("Human discussion");
    expect(comments[1].body).toBeNull();
    expect(client.updateComment).not.toHaveBeenCalled();
    expect(comments).toHaveLength(3);
  });
  it("checks every page before deciding whether to create", async () => {
    const { client } = fakeCommentClient(
      [
        { id: 1, body: "Discussion" },
        { id: 2, body: `${COMMENT_MARKER}\nPrior result` },
      ],
      1,
    );
    await upsertComment(client, { ...prContext, body });
    expect(client.listComments.mock.calls.map(([input]) => input.page)).toEqual(
      [1, 2],
    );
    expect(client.createComment).not.toHaveBeenCalled();
    expect(client.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: 2 }),
    );
  });
  it("serializes concurrent writers to the same PR in this process", async () => {
    const { client, comments } = fakeCommentClient();
    await Promise.all(
      Array.from({ length: 5 }, () =>
        upsertComment(client, { ...prContext, body }),
      ),
    );
    expect(comments).toHaveLength(1);
    expect(client.createComment).toHaveBeenCalledTimes(1);
  });
  it("does not create if listing fails", async () => {
    const { client } = fakeCommentClient();
    client.listComments.mockRejectedValueOnce(new Error("Unavailable"));
    await expect(upsertComment(client, { ...prContext, body })).rejects.toThrow(
      "Unavailable",
    );
    expect(client.createComment).not.toHaveBeenCalled();
    // A failed writer releases the queue for a later complete run.
    await expect(
      upsertComment(client, { ...prContext, body }),
    ).resolves.toHaveProperty("action", "created");
  });
  it("chooses the oldest existing marker without creating another", async () => {
    const { client } = fakeCommentClient(
      [
        { id: 8, body: `${COMMENT_MARKER}\nOld` },
        { id: 3, body: `${COMMENT_MARKER}\nOlder` },
      ],
      1,
    );
    await upsertComment(client, { ...prContext, body });
    expect(client.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: 3 }),
    );
    expect(client.createComment).not.toHaveBeenCalled();
  });
  it("rejects a missing marker or oversized body before making requests", async () => {
    const { client } = fakeCommentClient();
    await expect(
      upsertComment(client, { ...prContext, body: "No marker" }),
    ).rejects.toThrow();
    await expect(
      upsertComment(client, {
        ...prContext,
        body: COMMENT_MARKER + "x".repeat(60_000),
      }),
    ).rejects.toThrow();
    expect(client.listComments).not.toHaveBeenCalled();
  });
});
