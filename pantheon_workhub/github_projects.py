"""Bounded GitHub Projects V2 client. No implicit credential discovery or writes."""
import json
import os
from urllib.request import Request, urlopen
from urllib.error import HTTPError

ENDPOINT = "https://api.github.com/graphql"

class ProjectsError(RuntimeError):
    pass

class ProjectsV2:
    def __init__(self, token, owner, project_number=1, transport=None):
        if not token or not owner or not isinstance(project_number, int) or project_number < 1:
            raise ValueError("token, owner and positive project number required")
        self._token = token
        self.owner = owner
        self.number = project_number
        self._transport = transport or self._request

    def _request(self, payload):
        req = Request(ENDPOINT, data=json.dumps(payload).encode(),
                      headers={"Authorization": "Bearer " + self._token,
                               "Content-Type": "application/json",
                               "Accept": "application/vnd.github+json",
                               "User-Agent": "pantheon-workhub-projects"})
        try:
            with urlopen(req, timeout=15) as response:
                return json.load(response)
        except HTTPError as exc:
            raise ProjectsError("GitHub HTTP status " + str(exc.code)) from None

    def _query(self, query, variables):
        result = self._transport({"query": query, "variables": variables})
        if not isinstance(result, dict):
            raise ProjectsError("Invalid GitHub response")
        if result.get("errors"):
            raise ProjectsError("GitHub GraphQL error: " +
                                "; ".join(str(e.get("message", "unknown")) for e in result["errors"]))
        if "data" not in result:
            raise ProjectsError("Missing GraphQL data")
        return result["data"]

    def project(self):
        q = """query($owner:String!,$number:Int!){
          user(login:$owner){projectV2(number:$number){id title url}}
        }"""
        data = self._query(q, {"owner": self.owner, "number": self.number})
        project = (data.get("user") or {}).get("projectV2")
        if not project or not project.get("id"):
            raise ProjectsError("Project not found or inaccessible")
        return project

    def items(self, first=50, after=None):
        if not 1 <= first <= 100:
            raise ValueError("first must be between 1 and 100")
        q = """query($owner:String!,$number:Int!,$first:Int!,$after:String){
          user(login:$owner){projectV2(number:$number){
            id items(first:$first,after:$after){
              nodes{id type content{... on Issue{id title url} ... on PullRequest{id title url} ... on DraftIssue{id title}}}
              pageInfo{hasNextPage endCursor}
            }
          }}
        }"""
        data = self._query(q, {"owner":self.owner,"number":self.number,"first":first,"after":after})
        project = (data.get("user") or {}).get("projectV2")
        if not project:
            raise ProjectsError("Project not found or inaccessible")
        return project["items"]

    def add_item(self, content_id, *, approved=False):
        if not approved:
            raise PermissionError("Explicit approval required for Project write")
        if not content_id or not content_id.startswith(("I_", "PR_")):
            raise ValueError("Expected GitHub Issue or PullRequest node ID")
        project_id = self.project()["id"]
        q = """mutation($project:ID!,$content:ID!){
          addProjectV2ItemById(input:{projectId:$project,contentId:$content}){item{id}}
        }"""
        data = self._query(q, {"project":project_id,"content":content_id})
        item = (data.get("addProjectV2ItemById") or {}).get("item")
        if not item or not item.get("id"):
            raise ProjectsError("Write not confirmed by GitHub")
        return item

    def update_field(self, item_id, field_id, option_id, *, approved=False):
        if not approved:
            raise PermissionError("Explicit approval required for Project write")
        if not all((item_id,field_id,option_id)):
            raise ValueError("item, field and option IDs required")
        project_id = self.project()["id"]
        q = """mutation($project:ID!,$item:ID!,$field:ID!,$option:String!){
          updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,
            fieldId:$field,value:{singleSelectOptionId:$option}}){projectV2Item{id}}
        }"""
        data = self._query(q, {"project":project_id,"item":item_id,"field":field_id,"option":option_id})
        item = (data.get("updateProjectV2ItemFieldValue") or {}).get("projectV2Item")
        if not item or item.get("id") != item_id:
            raise ProjectsError("Write not confirmed by GitHub")
        return item
