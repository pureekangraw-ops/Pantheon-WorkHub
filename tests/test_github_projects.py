import unittest
from pantheon_workhub.github_projects import ProjectsV2, ProjectsError

class ProjectsV2Tests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        def transport(payload):
            self.calls.append(payload)
            q = payload["query"]
            if "addProjectV2ItemById" in q:
                return {"data":{"addProjectV2ItemById":{"item":{"id":"PVTI_1"}}}}
            if "updateProjectV2ItemFieldValue" in q:
                return {"data":{"updateProjectV2ItemFieldValue":{"projectV2Item":{"id":"PVTI_1"}}}}
            if "items(first:" in q:
                return {"data":{"user":{"projectV2":{"id":"PVT_1","items":{"nodes":[],"pageInfo":{"hasNextPage":False,"endCursor":None}}}}}}
            return {"data":{"user":{"projectV2":{"id":"PVT_1","title":"Board","url":"https://github.com/users/owner/projects/1"}}}}
        self.client = ProjectsV2("fake-token","owner",1,transport=transport)

    def test_read_project_and_items(self):
        self.assertEqual(self.client.project()["id"],"PVT_1")
        self.assertEqual(self.client.items()["nodes"],[])

    def test_writes_require_approval(self):
        with self.assertRaises(PermissionError):
            self.client.add_item("I_123")
        with self.assertRaises(PermissionError):
            self.client.update_field("PVTI_1","PVTSSF_1","opt")
        self.assertEqual(self.calls,[])

    def test_add_item(self):
        self.assertEqual(self.client.add_item("I_123",approved=True)["id"],"PVTI_1")
        self.assertEqual(self.calls[-1]["variables"]["content"],"I_123")

    def test_update_field(self):
        self.assertEqual(self.client.update_field("PVTI_1","PVTSSF_1","opt",approved=True)["id"],"PVTI_1")

    def test_graphql_error(self):
        client = ProjectsV2("fake","owner",transport=lambda _:{"errors":[{"message":"denied"}]})
        with self.assertRaises(ProjectsError):
            client.project()

    def test_invalid_page_size(self):
        with self.assertRaises(ValueError):
            self.client.items(101)

if __name__ == "__main__":
    unittest.main()
